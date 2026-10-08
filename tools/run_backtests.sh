#!/usr/bin/env bash
# Run baseline NFI X7 and the hardened subclass over several stress windows (offline markets).
#
#   PY=/path/to/venv/bin/python tools/run_backtests.sh
#
# Env overrides:
#   WINDOWS  space separated freqtrade timeranges
#   STRATS   space separated strategy names
#   JOBS     parallel runs (each run needs ~2-6 GB RAM for 40 pairs / 6 months)
#   OUT      output directory
set -uo pipefail
cd "$(dirname "$0")/.."

PY=${PY:-/home/user/ftenv/bin/python}
OUT=${OUT:-user_data/backtest_results/compare}
WINDOWS=${WINDOWS:-"20220501-20221130 20240101-20240630 20240701-20241231 20250101-20250530"}
STRATS=${STRATS:-"NostalgiaForInfinityX7 NostalgiaForInfinityX7Hardened"}
JOBS=${JOBS:-2}
CONFIG=${CONFIG:-configs/backtest-binance-spot.json}
MARKETS=${MARKETS:-user_data/markets-binance-spot.json}

mkdir -p "$OUT"
export PY OUT CONFIG MARKETS

run_one() {
  local strat=$1 tr=$2
  local name="${strat}-${tr}"
  local dir="$OUT/$name"
  mkdir -p "$dir"
  echo "[$(date +%H:%M:%S)] start $name"
  if FT_MARKETS="$MARKETS" "$PY" tools/backtest_offline.py backtesting \
      --userdir user_data --config "$CONFIG" --strategy "$strat" --timerange "$tr" \
      --enable-protections --export trades --export-directory "$dir" --breakdown month \
      --cache none > "$dir/log.txt" 2>&1; then
    echo "[$(date +%H:%M:%S)] done  $name"
  else
    echo "[$(date +%H:%M:%S)] FAILED $name (see $dir/log.txt)"
    echo "$name" >> "$OUT/failures.txt"
  fi
}
export -f run_one

for s in $STRATS; do
  for w in $WINDOWS; do
    echo "$s $w"
  done
done | xargs -P "$JOBS" -n 2 bash -c 'run_one "$@"' _

echo "all runs finished"
