#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/valana-repartidor
export VALANA_ENV_FILE=.env.production

test -f .env.production
test -f .local/production-accounts.json
sudo docker compose --env-file .env.production config --quiet

mkdir -p .local/backups
respaldo=".local/backups/valana-$(date -u +%Y%m%dT%H%M%SZ).dump"
if test -e "$respaldo"; then echo 'Ya existe un respaldo con este nombre'; exit 1; fi
echo 'Creando respaldo PostgreSQL...'
sudo docker compose --env-file .env.production exec -T postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$respaldo"
test "$(stat -c %s "$respaldo")" -gt 1024
sudo docker compose --env-file .env.production exec -T postgres pg_restore --list < "$respaldo" > /dev/null
chmod 600 "$respaldo"
echo "Respaldo validado: $respaldo"

GIT_SSH_COMMAND='ssh -o IdentitiesOnly=yes -i /home/valanaadmin/.ssh/valana_github_deploy' git pull --ff-only origin main
sudo docker compose --env-file .env.production build api
sudo docker compose --env-file .env.production run --rm --no-deps api node apps/api/dist/scripts/migrate.js
sudo docker compose --env-file .env.production up -d --no-deps api
for intento in $(seq 1 30); do
  if curl --fail --silent --output /dev/null http://127.0.0.1:3001/salud; then break; fi
  sleep 2
done
curl --fail --silent --output /dev/null http://127.0.0.1:3001/salud

sudo docker compose --env-file .env.production exec -T api node apps/api/dist/scripts/provision-production.js admin
sudo docker compose --env-file .env.production exec -T api node apps/api/dist/scripts/provision-production.js finalizar
rm .local/production-accounts.json

curl --fail --silent --output /dev/null https://api.bostonbbs.com/salud
echo 'API, migraciones y cuentas verificadas. El archivo temporal de cuentas fue retirado.'
