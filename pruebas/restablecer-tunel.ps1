$ErrorActionPreference = 'Stop'
$inicio = (Get-Date).ToUniversalTime().AddSeconds(-2).ToString('yyyy-MM-ddTHH:mm:ssZ')

docker compose restart tunel | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo reiniciar el túnel.' }

$url = $null
for ($intento = 0; $intento -lt 30; $intento++) {
  $registro = (docker compose logs --no-color --since $inicio tunel 2>&1) -join "`n"
  $coincidencias = [regex]::Matches($registro, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($coincidencias.Count -gt 0) {
    $url = $coincidencias[$coincidencias.Count - 1].Value
    break
  }
  Start-Sleep -Seconds 1
}
if (-not $url) { throw 'El túnel no informó una URL nueva.' }

$env:WEBHOOK_TEST_URL = "$url/webhooks/meta"
try {
  # Valida primero la API local. El DNS del equipo puede conservar un NXDOMAIN
  # temporal después de crear la URL, aunque el DNS público ya la resuelva.
  Remove-Item Env:WEBHOOK_TEST_URL -ErrorAction SilentlyContinue
  node pruebas/webhook.mjs *> $null
  if ($LASTEXITCODE -ne 0) { throw 'El webhook local no pasó la verificación.' }

  $env:WEBHOOK_TEST_URL = "$url/webhooks/meta"
  $hostPublico = ([uri]$url).Host
  $token = (Get-Content .env | Where-Object { $_ -match '^META_VERIFY_TOKEN=' } | Select-Object -First 1) -replace '^META_VERIFY_TOKEN=', ''
  if (-not $token) { throw 'Falta META_VERIFY_TOKEN en .env.' }
  $reto = "$url/webhooks/meta?hub.mode=subscribe&hub.verify_token=$([uri]::EscapeDataString($token))&hub.challenge=12345678"
  $validado = $false
  for ($intento = 0; $intento -lt 30; $intento++) {
    $ip = Resolve-DnsName $hostPublico -Server 1.1.1.1 -Type A -ErrorAction SilentlyContinue |
      Where-Object { $_.Type -eq 'A' } | Select-Object -First 1 -ExpandProperty IPAddress
    if ($ip) {
      $codigo = & curl.exe -sS -o NUL -w '%{http_code}' --resolve "${hostPublico}:443:$ip" --max-time 10 $reto 2>$null
      if ($LASTEXITCODE -eq 0 -and $codigo -eq '200') { $validado = $true; break }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $validado) { throw 'El webhook público nuevo no pasó la verificación.' }
} finally {
  Remove-Item Env:WEBHOOK_TEST_URL -ErrorAction SilentlyContinue
}

node pruebas/meta-suscripcion.mjs configurar "$url/webhooks/meta"
if ($LASTEXITCODE -ne 0) { throw 'Meta no aceptó la callback nueva.' }
Write-Output "Túnel y callback de Meta operativos: $url/webhooks/meta"
