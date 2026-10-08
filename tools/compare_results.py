#!/usr/bin/env python3
"""
Summarise and compare freqtrade backtest results produced by tools/run_backtests.sh.

  python tools/compare_results.py user_data/backtest_results/compare > docs/backtest-results/summary.md

For every <strategy>-<timerange> directory the newest result zip is read and the key risk
metrics are tabulated: closed-trade profit, profit including still-open positions (NFI
"bags"), max drawdown on closed trades, max drawdown on wallet balance (includes open
positions), win rate, number of trades, trades left open and the exit reasons added by the
hardened layer.
"""

import json
import sys
import zipfile
from pathlib import Path

import pandas as pd


def load_result(result_dir: Path):
  zips = sorted(result_dir.glob("backtest-result-*.zip"))
  if not zips:
    return None
  zf = zipfile.ZipFile(zips[-1])
  main_json = [n for n in zf.namelist() if n.endswith(".json") and "_config" not in n and "market_change" not in n]
  if not main_json:
    return None
  data = json.loads(zf.read(main_json[0]))
  strat_name = list(data["strategy"].keys())[0]
  res = data["strategy"][strat_name]
  wallet_df = None
  wallet_files = [n for n in zf.namelist() if n.endswith("_wallet.feather")]
  if wallet_files:
    import io

    wallet_df = pd.read_feather(io.BytesIO(zf.read(wallet_files[0])))
  return strat_name, res, wallet_df


def wallet_drawdown(wallet_df: pd.DataFrame | None, starting_balance: float):
  """Max drawdown of total wallet value (closed + unrealised)."""
  if wallet_df is None or wallet_df.empty:
    return None
  col = None
  for candidate in ("total_quote", "total", "balance", "wallet_total", "equity"):
    if candidate in wallet_df.columns:
      col = candidate
      break
  if col is None:
    numeric = [c for c in wallet_df.columns if pd.api.types.is_numeric_dtype(wallet_df[c]) and c != "date"]
    if not numeric:
      return None
    col = numeric[-1]
  series = wallet_df[col].astype(float)
  peak = series.cummax()
  dd = (series - peak) / peak
  return float(-dd.min())


def summarise(result_dir: Path) -> dict | None:
  loaded = load_result(result_dir)
  if loaded is None:
    return None
  strat_name, res, wallet_df = loaded
  trades = pd.DataFrame(res.get("trades", []))
  open_trades = trades[trades["is_open"]] if not trades.empty and "is_open" in trades else pd.DataFrame()
  closed_profit_abs = float(res["profit_total_abs"])
  open_profit_abs = float(open_trades["profit_abs"].sum()) if not open_trades.empty else 0.0
  start = float(res["starting_balance"])
  hard_exits = {}
  if not trades.empty and "exit_reason" in trades:
    for reason, cnt in trades["exit_reason"].value_counts().items():
      if "exit_hard_" in str(reason):
        key = str(reason).split(" ")[0]
        hard_exits[key] = hard_exits.get(key, 0) + int(cnt)
  wdd = wallet_drawdown(wallet_df, start)
  if wdd is None:
    wdd = res.get("max_relative_drawdown")
  return {
    "run": result_dir.name,
    "strategy": strat_name,
    "timerange": res.get("timerange"),
    "trades": int(res["total_trades"]),
    "winrate_pct": round(100 * float(res["winrate"]), 1),
    "profit_closed_pct": round(100 * closed_profit_abs / start, 2),
    "profit_incl_open_pct": round(100 * (closed_profit_abs + open_profit_abs) / start, 2),
    "open_at_end": int(len(open_trades)),
    "open_unrealised_pct": round(100 * open_profit_abs / start, 2),
    "max_dd_closed_pct": round(100 * float(res.get("max_drawdown_account", 0.0)), 2),
    "max_dd_wallet_pct": round(100 * float(wdd), 2) if wdd is not None else None,
    "market_change_pct": round(100 * float(res.get("market_change", 0.0)), 1),
    "sharpe": round(float(res.get("sharpe", 0.0)), 2),
    "profit_factor": round(float(res.get("profit_factor", 0.0)), 2),
    "worst_trade_pct": round(100 * float(trades["profit_ratio"].min()), 1) if not trades.empty else None,
    "max_consec_losses": int(res.get("max_consecutive_losses", 0)),
    "hard_exits": hard_exits,
  }


def main(argv):
  base = Path(argv[1]) if len(argv) > 1 else Path("user_data/backtest_results/compare")
  rows = []
  for d in sorted(p for p in base.iterdir() if p.is_dir()):
    s = summarise(d)
    if s:
      rows.append(s)
  if not rows:
    print("no results found", file=sys.stderr)
    return 1
  df = pd.DataFrame(rows)
  cols = [
    "timerange",
    "strategy",
    "trades",
    "winrate_pct",
    "profit_closed_pct",
    "profit_incl_open_pct",
    "open_at_end",
    "open_unrealised_pct",
    "max_dd_closed_pct",
    "max_dd_wallet_pct",
    "worst_trade_pct",
    "max_consec_losses",
    "market_change_pct",
    "hard_exits",
  ]
  df = df.sort_values(["timerange", "strategy"])[cols]
  print("| " + " | ".join(cols) + " |")
  print("|" + "---|" * len(cols))
  for _, r in df.iterrows():
    print("| " + " | ".join(str(r[c]) for c in cols) + " |")
  (base / "summary.json").write_text(json.dumps(rows, indent=1, default=str))
  return 0


if __name__ == "__main__":
  sys.exit(main(sys.argv))
