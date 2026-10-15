#!/usr/bin/env bash
set -e
sudo systemctl disable --now autorontgen 2>/dev/null || true
sudo rm -f /etc/systemd/system/autorontgen.service /etc/autorontgen.env
sudo systemctl daemon-reload
echo "Autoröntgen-palvelu poistettu (tiedostot jäivät hakemistoon)."
