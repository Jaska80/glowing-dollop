#!/usr/bin/env python3
"""
Build a ccxt-style markets file from local feather candle data so that freqtrade
backtests can run without network access to the exchange.

Usage:
  python tools/offline_markets.py user_data/data/binance user_data/markets-binance-spot.json

Precision is derived from the median price (7 significant digits for price,
amount step so that a 5 USDT order has ~3 significant digits). Good enough for
backtesting; NOT for live trading.
"""

import json
import math
import re
import sys
from pathlib import Path

import pandas as pd


def _tick_from_price(price: float, sig: int = 5) -> float:
  if price <= 0 or not math.isfinite(price):
    return 1e-8
  exp = math.floor(math.log10(price)) - (sig - 1)
  return float(10**exp)


def build_markets(datadir: Path, quote: str = "USDT", timeframe: str = "5m") -> dict:
  markets = {}
  pattern = re.compile(rf"^([A-Z0-9]+)_{quote}-{timeframe}\.feather$")
  for path in sorted(datadir.iterdir()):
    m = pattern.match(path.name)
    if not m:
      continue
    base = m.group(1)
    df = pd.read_feather(path, columns=["close"])
    if df.empty:
      continue
    median_price = float(df["close"].tail(5000).median())
    price_tick = _tick_from_price(median_price, 7)
    # amount step: ~3 significant digits on a 5 USDT order
    amount_step = _tick_from_price(5.0 / median_price, 3)
    symbol = f"{base}/{quote}"
    markets[symbol] = {
      "id": f"{base}{quote}",
      "symbol": symbol,
      "base": base,
      "quote": quote,
      "settle": None,
      "baseId": base,
      "quoteId": quote,
      "settleId": None,
      "type": "spot",
      "spot": True,
      "margin": False,
      "swap": False,
      "future": False,
      "option": False,
      "active": True,
      "contract": False,
      "linear": None,
      "inverse": None,
      "contractSize": None,
      "expiry": None,
      "expiryDatetime": None,
      "strike": None,
      "optionType": None,
      "taker": 0.001,
      "maker": 0.001,
      "percentage": True,
      "tierBased": False,
      "feeSide": "get",
      "precision": {"amount": amount_step, "price": price_tick, "base": 1e-8, "quote": 1e-8},
      "limits": {
        "amount": {"min": amount_step, "max": 9_000_000_000.0},
        "price": {"min": price_tick, "max": 1_000_000_000.0},
        "cost": {"min": 5.0, "max": 9_000_000_000.0},
        "leverage": {"min": None, "max": None},
        "market": {"min": None, "max": None},
      },
      "info": {},
    }
  return markets


def main(argv):
  if len(argv) != 3:
    print(__doc__)
    return 2
  datadir = Path(argv[1])
  out = Path(argv[2])
  markets = build_markets(datadir)
  out.write_text(json.dumps(markets, indent=1))
  print(f"wrote {len(markets)} markets to {out}")
  return 0


if __name__ == "__main__":
  sys.exit(main(sys.argv))
