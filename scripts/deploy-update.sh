#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/valana-repartidor
export VALANA_ENV_FILE=.env.production

test -f .env.production
mkdir -p .local/backups
exec 9>.local/deploy-production.lock
flock -n 9 || { echo 'Ya hay otro despliegue en curso.' >&2; exit 1; }
if ps -eo pid=,stat=,comm=,args= | awk -v propio="$$" '
  $1 != propio && (($3 == "bash" && $0 ~ /scripts\/deploy-(production|update)[.]sh/) ||
                    ($3 == "docker-compose" && $0 ~ /pg_dump/)) { encontrado=1 }
  END { exit !encontrado }
'; then
  echo 'Hay un despliegue o respaldo anterior todavía activo o suspendido.' >&2
  exit 1
fi

# Solo sudo -v puede pedir contraseña. Docker nunca lee del terminal durante el respaldo.
sudo -v
sudo -n true
sudo -n docker compose --env-file .env.production config --quiet </dev/null

respaldo=".local/backups/valana-$(date -u +%Y%m%dT%H%M%SZ).dump"
test ! -e "$respaldo" || { echo 'El respaldo ya existe.' >&2; exit 1; }
temporal=$(mktemp "${respaldo}.partial.XXXXXX")
validado=false
trap 'if [[ "$validado" != true && -e "$temporal" ]]; then echo "Respaldo incompleto conservado para revisión: $temporal" >&2; fi' EXIT
echo 'Creando respaldo PostgreSQL...'
contenedor=$(sudo -n timeout --signal=TERM --kill-after=10s 30s \
  docker compose --env-file .env.production ps -q postgres </dev/null)
test -n "$contenedor" || { echo 'PostgreSQL no está disponible.' >&2; exit 1; }
if ! sudo -n timeout --signal=TERM --kill-after=10s 300s docker exec "$contenedor" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  </dev/null > "$temporal"; then
  echo 'Falló o venció el respaldo. No se aplicaron migraciones.' >&2
  exit 1
fi
if ! test "$(stat -c %s "$temporal")" -gt 1024; then
  echo 'Respaldo incompleto. No se aplicaron migraciones.' >&2
  exit 1
fi
if ! sudo -n timeout --signal=TERM --kill-after=10s 60s \
  docker exec -i "$contenedor" pg_restore --list < "$temporal" > /dev/null; then
  echo 'El respaldo no pasó la validación. No se aplicaron migraciones.' >&2
  exit 1
fi
mv -- "$temporal" "$respaldo"
chmod 600 "$respaldo"
validado=true
echo "Respaldo validado: $respaldo"

GIT_SSH_COMMAND='ssh -o IdentitiesOnly=yes -i /home/valanaadmin/.ssh/valana_github_deploy' git pull --ff-only origin main
sudo -v
sudo -n docker compose --env-file .env.production build api </dev/null
sudo -n docker compose --env-file .env.production run --rm --no-deps -T api node apps/api/dist/scripts/migrate.js </dev/null
sudo -n docker compose --env-file .env.production up -d --no-deps api </dev/null
for intento in $(seq 1 30); do
  if curl --fail --silent --output /dev/null http://127.0.0.1:3001/salud; then break; fi
  sleep 2
done
curl --fail --silent --output /dev/null http://127.0.0.1:3001/salud
curl --fail --silent --output /dev/null https://api.bostonbbs.com/salud
echo 'API y migraciones verificadas. No se modificaron las cuentas.'
