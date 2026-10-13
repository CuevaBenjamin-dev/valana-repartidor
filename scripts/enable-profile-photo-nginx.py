#!/usr/bin/env python3
from pathlib import Path
import os
import shutil
import tempfile

config = Path('/etc/nginx/sites-available/valana-api')
backup = Path('/opt/valana-repartidor/.local/backups/valana-api-before-photo.conf')
original = config.read_text()
if 'server_name api.bostonbbs.com;' not in original:
    raise SystemExit('No se encontró el sitio Nginx de Valana; no se modificó nada')
if 'location = /perfil/foto {' in original:
    print('El límite de fotografía ya está configurado')
    raise SystemExit(0)
anchor = '    location / {'
if original.count(anchor) != 1:
    raise SystemExit('La ubicación principal de Valana cambió; no se modificó Nginx')
if not backup.exists():
    shutil.copy2(config, backup)
    backup.chmod(0o600)
photo = '''    location = /perfil/foto {
        client_max_body_size 4m;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

'''
updated = original.replace(anchor, photo + anchor)
fd, name = tempfile.mkstemp(prefix='valana-api.', dir=str(config.parent))
try:
    with os.fdopen(fd, 'w') as output:
        output.write(updated)
    os.chmod(name, config.stat().st_mode & 0o777)
    os.replace(name, config)
except BaseException:
    Path(name).unlink(missing_ok=True)
    raise
print('Límite HTTPS de fotografía configurado; respaldo Nginx conservado')
