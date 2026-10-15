#!/usr/bin/env bash
# Autoröntgen – asennus Linux-palvelimelle (Debian/Ubuntu/Raspberry Pi OS). Asentaa Node 22:n jos puuttuu,
# luo systemd-palvelun joka käynnistyy automaattisesti, ja näyttää osoitteen.
# Käyttö:  cd autotarkistus && sudo bash deploy/install.sh [portti] [kayttaja:salasana]
set -euo pipefail
PORT="${1:-8787}"
AUTH="${2:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"

if [ "$(id -u)" -ne 0 ]; then echo "Aja sudo:lla: sudo bash deploy/install.sh"; exit 1; fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "→ Asennetaan Node.js 22 (NodeSource)…"
  apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "→ Node $(node --version)"

ENV_FILE=/etc/autorontgen.env
{
  echo "PORT=$PORT"
  echo "HOST=0.0.0.0"
  [ -n "$AUTH" ] && echo "BASIC_AUTH=$AUTH"
  echo "# REGCHECK_USER=kayttajatunnus   # rekisterinumeroapi.com / regcheck.org.uk – rekkarihaku (maksullinen)"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

cat > /etc/systemd/system/autorontgen.service <<UNIT
[Unit]
Description=Autoröntgen – rekkari/VIN-tarkistus
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now autorontgen
sleep 1
systemctl --no-pager --lines=8 status autorontgen || true
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "✔ Valmis. Avaa selaimessa:  http://${IP:-localhost}:$PORT"
[ -n "$AUTH" ] && echo "  Kirjautuminen: ${AUTH%%:*} / (antamasi salasana)" || echo "  Ei salasanaa – käytä vain lähiverkossa, tai asenna uudelleen: sudo bash deploy/install.sh $PORT kayttaja:salasana"
echo "  Lokit:        journalctl -u autorontgen -f"
echo "  Päivitys:     git pull && sudo systemctl restart autorontgen"
echo "  Poisto:       sudo systemctl disable --now autorontgen && sudo rm /etc/systemd/system/autorontgen.service $ENV_FILE"
