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
  $1 != propio && $3 == "bash" && $0 ~ /scripts\/deploy-(production|update|profile-recovery)[.]sh/ { encontrado=1 }
  END { exit !encontrado }
'; then echo 'Hay un despliegue anterior todavía activo.' >&2; exit 1; fi

sudo -v
sudo -n docker compose --env-file .env.production config --quiet </dev/null
respaldo=".local/backups/valana-$(date -u +%Y%m%dT%H%M%SZ).dump"
test ! -e "$respaldo" || { echo 'Ya existe un respaldo con este nombre.' >&2; exit 1; }
temporal=$(mktemp "${respaldo}.partial.XXXXXX")
validado=false
trap 'if [[ "$validado" != true && -e "$temporal" ]]; then echo "Respaldo incompleto conservado: $temporal" >&2; fi' EXIT
echo 'Creando respaldo PostgreSQL antes de modificar cuentas...'
contenedor=$(sudo -n timeout --signal=TERM --kill-after=10s 30s docker compose --env-file .env.production ps -q postgres </dev/null)
test -n "$contenedor" || { echo 'PostgreSQL no está disponible.' >&2; exit 1; }
if ! sudo -n timeout --signal=TERM --kill-after=10s 300s docker exec "$contenedor" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  </dev/null > "$temporal"; then echo 'Falló el respaldo. No se modificaron cuentas.' >&2; exit 1; fi
test "$(stat -c %s "$temporal")" -gt 1024 || { echo 'Respaldo incompleto.' >&2; exit 1; }
sudo -n timeout --signal=TERM --kill-after=10s 60s docker exec -i "$contenedor" pg_restore --list < "$temporal" > /dev/null \
  || { echo 'Respaldo inválido. No se modificaron cuentas.' >&2; exit 1; }
mv -- "$temporal" "$respaldo"
chmod 600 "$respaldo"
validado=true
echo "Respaldo validado: $respaldo"

GIT_SSH_COMMAND='ssh -o IdentitiesOnly=yes -i /home/valanaadmin/.ssh/valana_github_deploy' git pull --ff-only origin main
sudo -v
sudo -n docker compose --env-file .env.production build api </dev/null
sudo -n docker compose --env-file .env.production up -d --no-deps api </dev/null
for intento in $(seq 1 30); do
  if curl --fail --silent --output /dev/null http://127.0.0.1:3001/salud; then break; fi
  sleep 2
done
curl --fail --silent --output /dev/null http://127.0.0.1:3001/salud

sudo -n python3 scripts/enable-profile-photo-nginx.py </dev/null
if ! sudo -n nginx -t; then
  sudo -n cp .local/backups/valana-api-before-photo.conf /etc/nginx/sites-available/valana-api
  echo 'Nginx no pasó la validación; se restauró su configuración anterior. No se modificaron cuentas.' >&2
  exit 1
fi
sudo -n systemctl reload nginx
curl --fail --silent --output /dev/null https://api.bostonbbs.com/salud

if test -e .local/reset-three-accounts.done; then
  echo 'Las tres contraseñas ya se restablecieron en una ejecución anterior; no se generan de nuevo.'
else
  echo 'Las siguientes contraseñas se mostrarán solo en esta terminal. Cópialas antes de cerrarla.'
  sudo -n docker compose --env-file .env.production exec -T api node apps/api/dist/scripts/reset-production-passwords.js </dev/null
  touch .local/reset-three-accounts.done
  chmod 600 .local/reset-three-accounts.done
fi
echo 'API y acceso HTTPS verificados; fin del despliegue de recuperación.'
