"""
NostalgiaForInfinityX7Hardened
==============================

A thin, auditable risk layer on top of the unmodified upstream NostalgiaForInfinityX7
(https://github.com/iterativv/NostalgiaForInfinity).

The upstream file (~80k lines) is left untouched so it can be updated with a plain copy.
Everything this class does is an *override* of a freqtrade callback, and every guard can be
switched off from config:

    "hardened_parameters": {
      "hard_stop_enable": false,
      ...
    }

What it fixes / adds (see docs/ANALYYSI.md for the reasoning and the issue references):

  1. Hard stop on the whole position (upstream default has NO loss exit at all:
     stoploss=-0.99, system_v3_2_stops_enable=False, u_e_stops_enable=False and
     confirm_trade_exit vetoes freqtrade's own stop_loss).
  2. Liquidation-proximity exit in futures mode (upstream issue #1038).
  3. Time stop for positions that are old and still under water.
  4. Cooldown that blocks a grind re-buy right after a derisk partial sell
     (upstream issue #1036: sell and re-buy seconds apart at the same price).
  5. Market-wide crash guard: no new longs and no grind buys while BTC is in a
     fast drawdown (upstream issue #1325, October 2025 crash).
  6. Pair "falling knife" guard for grind buys.
  7. Futures derisk/grind thresholds rescaled to the configured leverage
     (upstream issue #1035: thresholds are in margin space and assume 3x).
  8. Workaround for upstream bug: grind_mode_first_entry_stop_threshold_futures is
     never read (ternary reads the _spot value on both branches, issue #1245).
  9. Freqtrade native protections (CooldownPeriod, MaxDrawdown, LowProfitPairs).
 10. Tighter default slippage guard and the upstream bad-trade controller switched on.

Nothing here makes the strategy "unbeatable". It makes the tail risk explicit and bounded.
"""

import logging
import pathlib
import sys
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from pandas import DataFrame

from freqtrade.persistence import Order, Trade

# Allow "from NostalgiaForInfinityX7 import ..." when both files live in the same strategies dir.
_HERE = str(pathlib.Path(__file__).resolve().parent)
if _HERE not in sys.path:
  sys.path.insert(0, _HERE)

from NostalgiaForInfinityX7 import NostalgiaForInfinityX7  # noqa: E402

log = logging.getLogger(__name__)


class NostalgiaForInfinityX7Hardened(NostalgiaForInfinityX7):
  INTERFACE_VERSION = 3

  def version(self) -> str:
    return f"{super().version()}-hardened-1.0"

  # ---------------------------------------------------------------------------------------------
  # Hardening parameters. All overridable from config["hardened_parameters"].
  # Ratios are *notional* (price-space) ratios relative to the FIRST entry stake, i.e. the same
  # unit as upstream's profit_init_ratio. They are leverage independent.
  # ---------------------------------------------------------------------------------------------

  # 1. Hard stop on total position loss (realized partial exits included).
  hard_stop_enable = True
  hard_stop_init_ratio_spot = -0.25
  hard_stop_init_ratio_futures = -0.18

  # 2. Liquidation guard (futures only). Exit when price is within this band of the liq price.
  hard_liq_guard_enable = True
  hard_liq_guard_band = 0.10

  # 3. Time stop: position older than N days and still losing more than X.
  hard_time_stop_enable = True
  hard_time_stop_days = 30
  hard_time_stop_init_ratio = -0.03

  # 4. No grind/rebuy buy within N minutes after a derisk partial sell on the same trade.
  hard_grind_cooldown_after_derisk_minutes = 60

  # 5. BTC crash guard: block new longs and grind buys. Ratios on BTC 4h closes.
  hard_btc_crash_guard_enable = True
  hard_btc_crash_24h = -0.08
  hard_btc_crash_72h = -0.15
  hard_block_grind_buys_in_crash = True

  # 6. Pair knife guard for grind buys: ROC_288 (24h on 5m candles, in percent).
  hard_pair_knife_guard_enable = True
  hard_pair_knife_roc_288_pct = -15.0

  # 7. Rescale futures thresholds to the configured leverage (upstream tuned for 3x).
  hard_scale_futures_thresholds_to_leverage = True

  # 8. Upstream bug workaround (issue #1245).
  hard_fix_grind_mode_stop_threshold = True

  # 9. Freqtrade protections.
  hard_protections_enable = True
  hard_protection_cooldown_candles = 6
  hard_protection_max_drawdown = 0.15
  hard_protection_max_drawdown_lookback_candles = 576  # 48h
  hard_protection_max_drawdown_trade_limit = 4
  hard_protection_max_drawdown_stop_candles = 288  # 24h
  hard_protection_low_profit_lookback_candles = 1440  # 5d
  hard_protection_low_profit_trade_limit = 3
  hard_protection_low_profit_stop_candles = 288  # 24h

  # 10. Misc.
  hard_max_slippage = 0.01
  hard_enable_bad_trade_controller = True

  _HARD_PARAM_PREFIX = "hard_"

  # Futures attributes whose values are in *margin* space (compared as value / leverage).
  _LEVERAGE_SCALED_FUTURES_ATTRS = (
    "system_v3_2_derisk_level_1_futures",
    "system_v3_2_derisk_level_2_futures",
    "system_v3_2_derisk_level_3_futures",
    "system_v3_2_derisk_level_4_futures",
    "system_v3_derisk_level_1_futures",
    "system_v3_derisk_level_2_futures",
    "system_v3_derisk_level_3_futures",
    "system_v3_grind_1_thresholds_futures",
    "system_v3_grind_2_thresholds_futures",
    "system_v3_grind_3_thresholds_futures",
    "system_v3_grind_4_thresholds_futures",
    "system_v3_grind_5_thresholds_futures",
    "system_v3_grind_1_derisk_futures",
    "system_v3_grind_2_derisk_futures",
    "system_v3_grind_3_derisk_futures",
    "system_v3_grind_4_derisk_futures",
    "system_v3_grind_5_derisk_futures",
    "system_v3_grind_1_profit_threshold_futures",
    "system_v3_grind_2_profit_threshold_futures",
    "system_v3_grind_3_profit_threshold_futures",
    "system_v3_grind_4_profit_threshold_futures",
    "system_v3_grind_5_profit_threshold_futures",
    "system_v3_1_rebuy_thresholds_futures",
    "system_v3_2_stop_threshold_doom_futures",
    "system_v3_2_stop_threshold_futures_rebuy",
    "system_v3_2_stop_threshold_rapid_futures",
    "system_v3_2_stop_threshold_scalp_futures",
    "grinds_stop_futures",
  )

  # ---------------------------------------------------------------------------------------------
  # Init
  # ---------------------------------------------------------------------------------------------
  def __init__(self, config: dict) -> None:
    # Apply hardening parameters before upstream init so that upstream reads the final values.
    self._apply_hardened_parameters(config.get("hardened_parameters"))
    super().__init__(config)

    self.max_slippage = self.hard_max_slippage
    if self.hard_enable_bad_trade_controller:
      self.bad_trade_controller_enable = True

    if self.is_futures_mode:
      if self.hard_fix_grind_mode_stop_threshold:
        # Upstream reads the *_spot value on both branches of its ternary (issue #1245).
        # Copy the futures value into the spot attribute so the futures value is effective.
        self.grind_mode_first_entry_stop_threshold_spot = self.grind_mode_first_entry_stop_threshold_futures
      if self.hard_scale_futures_thresholds_to_leverage:
        self._scale_futures_thresholds_to_leverage()

    self.protections = self._build_protections()

  def _apply_hardened_parameters(self, params) -> None:
    if not isinstance(params, dict):
      return
    for key, value in params.items():
      if key.startswith(self._HARD_PARAM_PREFIX) and hasattr(self, key):
        log.info(f'Hardened parameter {key} changed from "{getattr(self, key)}" to "{value}".')
        setattr(self, key, value)
      else:
        log.warning(f"Unknown hardened parameter: {key}.")

  def _scale_futures_thresholds_to_leverage(self) -> None:
    """Upstream futures thresholds are compared as threshold / leverage and were tuned for 3x.
    Rescale so that the price-space behaviour stays the same at any configured leverage."""
    leverage = float(self.futures_mode_leverage)
    if leverage <= 0 or abs(leverage - 3.0) < 1e-9:
      return
    factor = leverage / 3.0
    for attr in self._LEVERAGE_SCALED_FUTURES_ATTRS:
      if not hasattr(self, attr):
        continue
      value = getattr(self, attr)
      if isinstance(value, (list, tuple)):
        setattr(self, attr, [v * factor for v in value])
      elif isinstance(value, (int, float)) and not isinstance(value, bool):
        setattr(self, attr, value * factor)
    log.info(f"Hardened: futures thresholds rescaled from 3x to {leverage}x (factor {factor:.3f}).")

  def _build_protections(self) -> list:
    if not self.hard_protections_enable:
      return []
    return [
      {
        "method": "CooldownPeriod",
        "stop_duration_candles": int(self.hard_protection_cooldown_candles),
      },
      {
        "method": "MaxDrawdown",
        "lookback_period_candles": int(self.hard_protection_max_drawdown_lookback_candles),
        "trade_limit": int(self.hard_protection_max_drawdown_trade_limit),
        "stop_duration_candles": int(self.hard_protection_max_drawdown_stop_candles),
        "max_allowed_drawdown": float(self.hard_protection_max_drawdown),
      },
      {
        "method": "LowProfitPairs",
        "lookback_period_candles": int(self.hard_protection_low_profit_lookback_candles),
        "trade_limit": int(self.hard_protection_low_profit_trade_limit),
        "stop_duration_candles": int(self.hard_protection_low_profit_stop_candles),
        "required_profit": 0.0,
        "only_per_pair": True,
      },
    ]

  # ---------------------------------------------------------------------------------------------
  # BTC informative: add 24h / 72h rate of change on 4h closes.
  # Merged into the pair dataframe by upstream as BTC_ROC_6_4h / BTC_ROC_18_4h (ffilled).
  # ---------------------------------------------------------------------------------------------
  def btc_informative_4h_indicators(self, btc_pair: str, btc_info_timeframe: str) -> DataFrame:
    btc_df = super().btc_informative_4h_indicators(btc_pair, btc_info_timeframe)
    if btc_df.empty:
      return btc_df
    close = btc_df["close"]
    btc_df["BTC_ROC_6"] = close / close.shift(6) - 1.0
    btc_df["BTC_ROC_18"] = close / close.shift(18) - 1.0
    return btc_df

  # ---------------------------------------------------------------------------------------------
  # Guards (pure functions over a candle row, easy to unit test)
  # ---------------------------------------------------------------------------------------------
  def _btc_crash_active(self, last_candle) -> bool:
    if not self.hard_btc_crash_guard_enable:
      return False
    roc_24h = last_candle.get("BTC_ROC_6_4h") if hasattr(last_candle, "get") else None
    roc_72h = last_candle.get("BTC_ROC_18_4h") if hasattr(last_candle, "get") else None
    if roc_24h is not None and np.isfinite(roc_24h) and bool(roc_24h <= self.hard_btc_crash_24h):
      return True
    if roc_72h is not None and np.isfinite(roc_72h) and bool(roc_72h <= self.hard_btc_crash_72h):
      return True
    return False

  def _pair_knife_active(self, last_candle, is_short: bool) -> bool:
    if not self.hard_pair_knife_guard_enable:
      return False
    roc = last_candle.get("ROC_288") if hasattr(last_candle, "get") else None
    if roc is None or not np.isfinite(roc):
      return False
    if is_short:
      return bool(roc >= -self.hard_pair_knife_roc_288_pct)
    return bool(roc <= self.hard_pair_knife_roc_288_pct)

  @staticmethod
  def _last_filled_order(trade: Trade) -> Optional[Order]:
    filled = trade.select_filled_orders()
    return filled[-1] if filled else None

  def _grind_cooldown_active(self, trade: Trade, current_time: datetime) -> bool:
    minutes = self.hard_grind_cooldown_after_derisk_minutes
    if not minutes or minutes <= 0:
      return False
    last = self._last_filled_order(trade)
    if last is None or last.ft_order_side != trade.exit_side:
      return False
    tag = last.ft_order_tag or ""
    if "derisk" not in tag:
      return False
    filled_at = getattr(last, "order_filled_utc", None) or getattr(last, "order_date_utc", None)
    if filled_at is None:
      return False
    if current_time.tzinfo is None:
      current_time = current_time.replace(tzinfo=filled_at.tzinfo)
    return (current_time - filled_at) < timedelta(minutes=minutes)

  def _hard_exit_reason(self, trade: Trade, current_time: datetime, current_rate: float) -> Optional[str]:
    filled_entries = trade.select_filled_orders(trade.entry_side)
    if not filled_entries:
      return None

    # Liquidation guard (futures)
    if self.hard_liq_guard_enable and self.is_futures_mode:
      liq = getattr(trade, "liquidation_price", None)
      if liq is not None and np.isfinite(liq) and liq > 0 and current_rate > 0:
        if trade.is_short:
          distance = (liq - current_rate) / current_rate
        else:
          distance = (current_rate - liq) / current_rate
        if 0.0 <= distance <= self.hard_liq_guard_band:
          return "exit_hard_liq_guard"

    filled_exits = trade.select_filled_orders(trade.exit_side)
    _, _, _, profit_init_ratio = self.calc_total_profit(trade, filled_entries, filled_exits, current_rate)

    # Hard stop on total position
    if self.hard_stop_enable:
      threshold = self.hard_stop_init_ratio_futures if self.is_futures_mode else self.hard_stop_init_ratio_spot
      if profit_init_ratio <= threshold:
        return "exit_hard_stop"

    # Time stop
    if self.hard_time_stop_enable:
      open_date = trade.open_date_utc
      if current_time.tzinfo is None and open_date.tzinfo is not None:
        current_time = current_time.replace(tzinfo=open_date.tzinfo)
      age_days = (current_time - open_date).total_seconds() / 86400.0
      if age_days >= self.hard_time_stop_days and profit_init_ratio <= self.hard_time_stop_init_ratio:
        return "exit_hard_time_stop"

    return None

  # ---------------------------------------------------------------------------------------------
  # Freqtrade callbacks
  # ---------------------------------------------------------------------------------------------
  def custom_exit(
    self, pair: str, trade: "Trade", current_time: "datetime", current_rate: float, current_profit: float, **kwargs
  ):
    reason = self._hard_exit_reason(trade, current_time, current_rate)
    if reason is not None:
      enter_tag = trade.enter_tag if getattr(trade, "enter_tag", None) else "empty"
      log.info(f"Hardened exit [{current_time}] [{pair}] {reason} at {current_rate}")
      return f"{reason} ( {enter_tag})"
    return super().custom_exit(pair, trade, current_time, current_rate, current_profit, **kwargs)

  def confirm_trade_entry(
    self,
    pair: str,
    order_type: str,
    amount: float,
    rate: float,
    time_in_force: str,
    current_time: datetime,
    entry_tag: Optional[str],
    side: str,
    **kwargs,
  ) -> bool:
    if entry_tag != "force_entry" and side == "long" and self.hard_btc_crash_guard_enable:
      df, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
      if len(df) >= 1 and self._btc_crash_active(df.iloc[-1]):
        log.info(f"[{current_time}] Hardened: cancelling long entry for {pair}, BTC crash guard active.")
        return False
    return super().confirm_trade_entry(
      pair, order_type, amount, rate, time_in_force, current_time, entry_tag, side, **kwargs
    )

  def adjust_trade_position(
    self,
    trade: Trade,
    current_time: datetime,
    current_rate: float,
    current_profit: float,
    min_stake: Optional[float],
    max_stake: float,
    current_entry_rate: float,
    current_exit_rate: float,
    current_entry_profit: float,
    current_exit_profit: float,
    **kwargs,
  ):
    result = super().adjust_trade_position(
      trade,
      current_time,
      current_rate,
      current_profit,
      min_stake,
      max_stake,
      current_entry_rate,
      current_exit_rate,
      current_entry_profit,
      current_exit_profit,
      **kwargs,
    )
    if result is None:
      return None
    stake = result[0] if isinstance(result, tuple) else result
    if stake is None or stake <= 0.0:
      # Partial exits (derisk, grind exits) are never blocked.
      return result

    # Cooldown after a derisk partial sell (issue #1036)
    if self._grind_cooldown_active(trade, current_time):
      log.info(f"[{current_time}] Hardened: blocking buy adjustment on {trade.pair}, derisk cooldown active.")
      return None

    if self.hard_block_grind_buys_in_crash or self.hard_pair_knife_guard_enable:
      df, _ = self.dp.get_analyzed_dataframe(trade.pair, self.timeframe)
      if len(df) >= 1:
        last_candle = df.iloc[-1]
        if self.hard_block_grind_buys_in_crash and not trade.is_short and self._btc_crash_active(last_candle):
          log.info(f"[{current_time}] Hardened: blocking buy adjustment on {trade.pair}, BTC crash guard active.")
          return None
        if self._pair_knife_active(last_candle, trade.is_short):
          log.info(f"[{current_time}] Hardened: blocking buy adjustment on {trade.pair}, pair knife guard active.")
          return None

    return result
