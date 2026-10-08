#!/usr/bin/env python3
"""
Run any freqtrade sub-command with exchange markets loaded from a local JSON file
instead of the exchange API. Needed in sandboxes without exchange network access.

Usage:
  FT_MARKETS=user_data/markets-binance-spot.json \
    python tools/backtest_offline.py backtesting --config ... --strategy ...

Everything after the script name is passed to freqtrade unchanged.
"""

import json
import os
import sys


def _install_offline_markets(markets_path: str) -> None:
  from freqtrade.exchange import exchange as ft_exchange

  with open(markets_path) as fh:
    markets = json.load(fh)

  def _load_async_markets(self, reload: bool = False) -> None:  # noqa: ARG001
    self._api_async.set_markets(markets)
    self._api.set_markets(markets)

  ft_exchange.Exchange._load_async_markets = _load_async_markets


def main() -> int:
  markets_path = os.environ.get("FT_MARKETS")
  if markets_path:
    _install_offline_markets(markets_path)
  from freqtrade.main import main as ft_main

  try:
    ft_main(sys.argv[1:])
  finally:
    try:
      import resource

      peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
      print(f"[backtest_offline] peak RSS: {peak_mb:.0f} MB", file=sys.stderr)
    except Exception:  # noqa: BLE001
      pass
  return 0


if __name__ == "__main__":
  sys.exit(main())
