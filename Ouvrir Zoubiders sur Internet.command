#!/bin/bash
# Double-cliquez sur ce fichier pour rendre Zoubiders accessible depuis Internet.
# Zoubiders doit déjà être lancé, avec les comptes activés. Fermez cette fenêtre pour couper l'accès.
cd "$(dirname "$0")"
PORT="${PORT:-3210}"
LIEN="${DATA_DIR:-donnees}/lien-internet.txt"
pause() { echo; read -r -p "Appuyez sur Entrée pour fermer cette fenêtre."; exit 1; }

ME=$(curl -s "http://127.0.0.1:$PORT/api/me")
[ -z "$ME" ] && { echo "Zoubiders n'est pas lancé : double-cliquez d'abord sur « Lancer Zoubiders.command »."; pause; }
echo "$ME" | grep -q '"accounts":true' || { echo "Activez d'abord les comptes dans Zoubiders (Réglages › Comptes) : sans comptes, n'importe qui verrait vos pages."; pause; }

trap 'rm -f "$LIEN"' EXIT
echo "Mise en ligne de Zoubiders… (laissez cette fenêtre ouverte)"
./outils/cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" 2>&1 | while IFS= read -r ligne; do
  url=$(echo "$ligne" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com')
  if [ -n "$url" ]; then
    echo "$url" > "$LIEN"
    echo
    echo "  ✅ Zoubiders est en ligne : $url"
    echo "  Envoyez ce lien avec le code d'invitation (Zoubiders › Réglages › Accès)."
    echo "  Pour couper l'accès : fermez cette fenêtre."
    echo
  fi
done
