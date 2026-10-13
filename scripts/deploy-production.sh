#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/valana-repartidor
export VALANA_ENV_FILE=.env.production

test -f .env.production
test -f .local/production-accounts.json
mkdir -p .local/backups
exec 9>.local/deploy-production.lock
flock -n 9 || { echo 'Ya hay otro despliegue en curso.' >&2; exit 1; }
if ps -eo pid=,comm=,args= | awk -v propio="$$" '
  $1 != propio && (($2 == "bash" && $0 ~ /scripts\/deploy-production[.]sh/) ||
                    ($2 == "docker-compose" && $0 ~ /pg_dump/)) { encontrado=1 }
  END { exit !encontrado }
'; then
  echo 'Queda una ejecución anterior del despliegue o respaldo. Detenla antes de continuar.' >&2
  exit 1
fi

# Única autenticación interactiva: ningún comando Docker posterior debe pedir entrada.
sudo -v
sudo -n true
sudo -n docker compose --env-file .env.production config --quiet </dev/null

respaldo=".local/backups/valana-$(date -u +%Y%m%dT%H%M%SZ).dump"
if test -e "$respaldo"; then echo 'Ya existe un respaldo con este nombre'; exit 1; fi
temporal=$(mktemp "${respaldo}.partial.XXXXXX")
respaldo_validado=false
trap 'if [[ "$respaldo_validado" != true && -e "$temporal" ]]; then echo "Respaldo incompleto conservado para revisión: $temporal" >&2; fi' EXIT
if find .local/backups -maxdepth 1 -name 'valana-*.dump' -type f -size 0 | grep -q .; then
  echo 'Aviso: existen respaldos anteriores de 0 bytes; no se usarán.' >&2
fi
echo 'Creando respaldo PostgreSQL...'
contenedor=$(sudo -n timeout --signal=TERM --kill-after=10s 30s \
  docker compose --env-file .env.production ps -q postgres </dev/null)
test -n "$contenedor" || { echo 'El contenedor PostgreSQL no está disponible.' >&2; exit 1; }
if ! sudo -n timeout --signal=TERM --kill-after=10s 300s docker exec "$contenedor" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  </dev/null > "$temporal"; then
  echo 'Falló o excedió el tiempo límite el respaldo PostgreSQL. No se aplicaron migraciones.' >&2
  exit 1
fi
if ! test "$(stat -c %s "$temporal")" -gt 1024; then
  echo 'Respaldo incompleto: tamaño insuficiente. No se aplicaron migraciones.' >&2
  exit 1
fi
if ! sudo -n timeout --signal=TERM --kill-after=10s 60s \
  docker exec -i "$contenedor" pg_restore --list < "$temporal" > /dev/null; then
  echo 'Respaldo inválido o validación agotada. No se aplicaron migraciones.' >&2
  exit 1
fi
mv -- "$temporal" "$respaldo"
chmod 600 "$respaldo"
respaldo_validado=true
echo "Respaldo validado: $respaldo"

GIT_SSH_COMMAND='ssh -o IdentitiesOnly=yes -i /home/valanaadmin/.ssh/valana_github_deploy' git pull --ff-only origin main
sudo -n docker compose --env-file .env.production build api </dev/null
sudo -n docker compose --env-file .env.production run --rm --no-deps -T api node apps/api/dist/scripts/migrate.js </dev/null
sudo -n docker compose --env-file .env.production up -d --no-deps api </dev/null
for intento in $(seq 1 30); do
  if curl --fail --silent --output /dev/null http://127.0.0.1:3001/salud; then break; fi
  sleep 2
done
curl --fail --silent --output /dev/null http://127.0.0.1:3001/salud

sudo -n docker compose --env-file .env.production exec -T api node apps/api/dist/scripts/provision-production.js admin </dev/null
sudo -n docker compose --env-file .env.production exec -T api node apps/api/dist/scripts/provision-production.js finalizar </dev/null
rm .local/production-accounts.json

curl --fail --silent --output /dev/null https://api.bostonbbs.com/salud
echo 'API, migraciones y cuentas verificadas. El archivo temporal de cuentas fue retirado.'
