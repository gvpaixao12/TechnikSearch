#!/usr/bin/env bash
# Build incremental do catálogo FIPE, pensado pra rodar via cron na VPS (ex.: a
# cada 3h). É RESUMÍVEL: cada rodada continua de onde a anterior parou (cache da
# fipe.js + chaves já indexadas no catalog.json), então marcas que tomam 429 numa
# rodada entram na próxima. Espaçar as rodadas deixa o rate limit da FIPE resetar.
#
#  - flock: evita duas rodadas sobrepostas (um build pode passar de 3h).
#  - só reinicia o pm2 se o catálogo realmente mudou (sem blip à toa).
#  - loga em /var/log/technik-build.log.
#
# Catálogo é "dono" da VPS: este script modifica server/data/catalog.json, que
# fica como mudança local não-commitada. Deploys (git pull de commits de código)
# não tocam esse arquivo, então não conflitam — só NÃO recommitar catalog.json.
#
# Instalar no cron:  0 */3 * * * /opt/technik/server/scripts/cron-build.sh
# Build full de 107 marcas: passe --all-brands editando a linha do node abaixo.

set -u
export PATH=/usr/bin:/usr/local/bin:$PATH

NODE=/usr/bin/node
PM2=/usr/bin/pm2
APP_DIR=/opt/technik/server
CATALOG="$APP_DIR/data/catalog.json"
LOG=/var/log/technik-build.log
LOCK=/tmp/technik-build.lock

ts()    { date '+%Y-%m-%d %H:%M:%S'; }
count() { "$NODE" -e "try{console.log(require('$CATALOG').entries.length)}catch(e){console.log(0)}" 2>/dev/null; }

# Lock: se já tem build rodando, sai sem fazer nada.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(ts)] build já em andamento — pulando esta rodada" >> "$LOG"
  exit 0
fi

cd "$APP_DIR" || { echo "[$(ts)] APP_DIR ausente"; exit 1; }
before=$(count)
echo "[$(ts)] ───── início (catálogo: $before) ─────" >> "$LOG"

"$NODE" scripts/build-catalog.js >> "$LOG" 2>&1
after=$(count)
echo "[$(ts)] fim (catálogo: $before -> $after)" >> "$LOG"

# Reinicia o app só se o número de carros mudou (catálogo cresceu/encolheu).
if [ "$after" != "$before" ]; then
  "$PM2" restart technik >> "$LOG" 2>&1
  echo "[$(ts)] pm2 restart — catálogo mudou ($before -> $after)" >> "$LOG"
fi
