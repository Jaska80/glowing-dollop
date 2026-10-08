"""
Unit tests for NostalgiaForInfinityX7Hardened guards.

Run:  /path/to/venv/bin/python -m pytest tests -q
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "user_data" / "strategies"))

from NostalgiaForInfinityX7Hardened import NostalgiaForInfinityX7Hardened  # noqa: E402


NOW = datetime(2026, 1, 20, 12, 0, tzinfo=timezone.utc)


class FakeOrder(SimpleNamespace):
  pass


class FakeTrade:
  def __init__(self, *, is_short=False, entries=None, exits=None, open_days_ago=1.0, liquidation_price=None):
    self.is_short = is_short
    self.pair = "TEST/USDT"
    self.enter_tag = "1"
    self.entry_side = "sell" if is_short else "buy"
    self.exit_side = "buy" if is_short else "sell"
    self.open_date_utc = NOW - timedelta(days=open_days_ago)
    self.liquidation_price = liquidation_price
    self.fee_open = 0.001
    self.fee_close = 0.001
    self.funding_fees = 0.0
    self.leverage = 1.0
    self._orders = []
    for price, amount in entries or []:
      self._orders.append(
        FakeOrder(
          ft_order_side=self.entry_side,
          ft_order_tag="1",
          safe_price=price,
          safe_filled=amount,
          order_filled_utc=NOW - timedelta(hours=10),
        )
      )
    for price, amount, tag, minutes_ago in exits or []:
      self._orders.append(
        FakeOrder(
          ft_order_side=self.exit_side,
          ft_order_tag=tag,
          safe_price=price,
          safe_filled=amount,
          order_filled_utc=NOW - timedelta(minutes=minutes_ago),
        )
      )

  def select_filled_orders(self, side=None):
    if side is None:
      return list(self._orders)
    return [o for o in self._orders if o.ft_order_side == side]


def make_strategy(**overrides):
  s = NostalgiaForInfinityX7Hardened.__new__(NostalgiaForInfinityX7Hardened)
  s.is_futures_mode = False
  s.custom_fee_open_rate = None
  s.custom_fee_close_rate = None
  s.timeframe = "5m"
  for k, v in overrides.items():
    setattr(s, k, v)
  return s


# ---------------------------------------------------------------------------------------------
# Hard stop / time stop / liquidation guard
# ---------------------------------------------------------------------------------------------
def test_hard_stop_triggers_on_total_position_loss_including_realized_derisk():
  s = make_strategy()
  # Bought 1.0 @ 100, derisked 0.5 @ 85 (realized loss), rest now @ 70.
  trade = FakeTrade(entries=[(100.0, 1.0)], exits=[(85.0, 0.5, "derisk_level_1", 120)])
  # total profit ≈ (-100.1) + 42.46 + 34.97 = -22.7  => -22.7% of the 100 initial stake
  assert s._hard_exit_reason(trade, NOW, 70.0) is None  # -22.7% > -25%
  assert s._hard_exit_reason(trade, NOW, 65.0) == "exit_hard_stop"  # ≈ -25.2%


def test_hard_stop_can_be_disabled():
  s = make_strategy(hard_stop_enable=False)
  trade = FakeTrade(entries=[(100.0, 1.0)])
  assert s._hard_exit_reason(trade, NOW, 50.0) is None


def test_time_stop_only_when_old_and_losing():
  s = make_strategy(hard_time_stop_days=30, hard_time_stop_init_ratio=-0.03)
  young = FakeTrade(entries=[(100.0, 1.0)], open_days_ago=10)
  old_losing = FakeTrade(entries=[(100.0, 1.0)], open_days_ago=31)
  old_winning = FakeTrade(entries=[(100.0, 1.0)], open_days_ago=31)
  assert s._hard_exit_reason(young, NOW, 90.0) is None
  assert s._hard_exit_reason(old_losing, NOW, 90.0) == "exit_hard_time_stop"
  assert s._hard_exit_reason(old_winning, NOW, 101.0) is None


def test_liquidation_guard_futures_long_and_short():
  s = make_strategy(is_futures_mode=True, hard_liq_guard_band=0.10)
  long_trade = FakeTrade(entries=[(100.0, 1.0)], liquidation_price=67.0)
  assert s._hard_exit_reason(long_trade, NOW, 90.0) is None
  assert s._hard_exit_reason(long_trade, NOW, 72.0) == "exit_hard_liq_guard"  # 7% above liq
  short_trade = FakeTrade(is_short=True, entries=[(100.0, 1.0)], liquidation_price=133.0)
  assert s._hard_exit_reason(short_trade, NOW, 110.0) is None
  assert s._hard_exit_reason(short_trade, NOW, 125.0) == "exit_hard_liq_guard"


def test_liquidation_guard_not_used_on_spot():
  s = make_strategy(is_futures_mode=False)
  trade = FakeTrade(entries=[(100.0, 1.0)], liquidation_price=67.0)
  assert s._hard_exit_reason(trade, NOW, 72.0) == "exit_hard_stop"  # -28% hits hard stop, not liq guard


# ---------------------------------------------------------------------------------------------
# Derisk -> grind cooldown
# ---------------------------------------------------------------------------------------------
def test_grind_cooldown_after_derisk():
  s = make_strategy(hard_grind_cooldown_after_derisk_minutes=60)
  recent = FakeTrade(entries=[(100.0, 1.0)], exits=[(90.0, 0.2, "derisk_level_1", 5)])
  old = FakeTrade(entries=[(100.0, 1.0)], exits=[(90.0, 0.2, "derisk_level_1", 120)])
  profit_exit = FakeTrade(entries=[(100.0, 1.0)], exits=[(110.0, 0.2, "grind_1_exit", 5)])
  assert s._grind_cooldown_active(recent, NOW) is True
  assert s._grind_cooldown_active(old, NOW) is False
  assert s._grind_cooldown_active(profit_exit, NOW) is False
  s.hard_grind_cooldown_after_derisk_minutes = 0
  assert s._grind_cooldown_active(recent, NOW) is False


# ---------------------------------------------------------------------------------------------
# BTC crash / pair knife guards
# ---------------------------------------------------------------------------------------------
def test_btc_crash_guard_thresholds():
  s = make_strategy(hard_btc_crash_24h=-0.08, hard_btc_crash_72h=-0.15)
  assert s._btc_crash_active(pd.Series({"BTC_ROC_6_4h": -0.05, "BTC_ROC_18_4h": -0.10})) is False
  assert s._btc_crash_active(pd.Series({"BTC_ROC_6_4h": -0.09, "BTC_ROC_18_4h": -0.10})) is True
  assert s._btc_crash_active(pd.Series({"BTC_ROC_6_4h": -0.02, "BTC_ROC_18_4h": -0.16})) is True
  assert s._btc_crash_active(pd.Series({"BTC_ROC_6_4h": float("nan"), "BTC_ROC_18_4h": float("nan")})) is False
  assert s._btc_crash_active(pd.Series({"close": 1.0})) is False
  s.hard_btc_crash_guard_enable = False
  assert s._btc_crash_active(pd.Series({"BTC_ROC_6_4h": -0.5})) is False


def test_pair_knife_guard_is_direction_aware():
  s = make_strategy(hard_pair_knife_roc_288_pct=-15.0)
  assert s._pair_knife_active(pd.Series({"ROC_288": -20.0}), is_short=False) is True
  assert s._pair_knife_active(pd.Series({"ROC_288": -10.0}), is_short=False) is False
  assert s._pair_knife_active(pd.Series({"ROC_288": 20.0}), is_short=True) is True
  assert s._pair_knife_active(pd.Series({"ROC_288": -20.0}), is_short=True) is False


def test_adjust_trade_position_blocks_only_buys(monkeypatch):
  s = make_strategy(hard_grind_cooldown_after_derisk_minutes=60)
  s.dp = SimpleNamespace(get_analyzed_dataframe=lambda pair, tf: (pd.DataFrame([{"ROC_288": -1.0}]), None))
  trade = FakeTrade(entries=[(100.0, 1.0)], exits=[(90.0, 0.2, "derisk_level_1", 5)])
  args = (trade, NOW, 88.0, -0.1, 5.0, 1000.0, 88.0, 88.0, -0.1, -0.1)

  monkeypatch.setattr(NostalgiaForInfinityX7Hardened.__bases__[0], "adjust_trade_position", lambda self, *a, **k: (20.0, "grind_1_entry"))
  assert s.adjust_trade_position(*args) is None  # buy blocked by cooldown

  monkeypatch.setattr(NostalgiaForInfinityX7Hardened.__bases__[0], "adjust_trade_position", lambda self, *a, **k: (-20.0, "derisk_level_2"))
  assert s.adjust_trade_position(*args) == (-20.0, "derisk_level_2")  # sells never blocked

  monkeypatch.setattr(NostalgiaForInfinityX7Hardened.__bases__[0], "adjust_trade_position", lambda self, *a, **k: None)
  assert s.adjust_trade_position(*args) is None


def test_adjust_trade_position_blocks_buy_in_btc_crash(monkeypatch):
  s = make_strategy()
  s.dp = SimpleNamespace(
    get_analyzed_dataframe=lambda pair, tf: (pd.DataFrame([{"ROC_288": -1.0, "BTC_ROC_6_4h": -0.12}]), None)
  )
  trade = FakeTrade(entries=[(100.0, 1.0)])
  args = (trade, NOW, 98.0, -0.02, 5.0, 1000.0, 98.0, 98.0, -0.02, -0.02)
  monkeypatch.setattr(NostalgiaForInfinityX7Hardened.__bases__[0], "adjust_trade_position", lambda self, *a, **k: (20.0, "grind_1_entry"))
  assert s.adjust_trade_position(*args) is None
  s.hard_block_grind_buys_in_crash = False
  assert s.adjust_trade_position(*args) == (20.0, "grind_1_entry")


# ---------------------------------------------------------------------------------------------
# Config / leverage scaling
# ---------------------------------------------------------------------------------------------
def test_hardened_parameters_from_config_only_known_prefix(caplog):
  s = make_strategy()
  s._apply_hardened_parameters({"hard_stop_init_ratio_spot": -0.3, "bogus": 1, "stoploss": -0.1})
  assert s.hard_stop_init_ratio_spot == -0.3
  assert "Unknown hardened parameter: bogus" in caplog.text
  assert "Unknown hardened parameter: stoploss" in caplog.text
  assert s.stoploss == -0.99


def test_futures_thresholds_scale_with_leverage():
  s = make_strategy(is_futures_mode=True, futures_mode_leverage=1.0)
  s.system_v3_2_derisk_level_1_futures = [-0.18, -0.35]
  s.system_v3_grind_1_derisk_futures = -0.22
  s.system_v3_2_stop_threshold_doom_futures = 0.35
  s._scale_futures_thresholds_to_leverage()
  # 1x leverage: thresholds must shrink by 3 to keep the same price-space distance.
  assert s.system_v3_2_derisk_level_1_futures == pytest.approx([-0.06, -0.35 / 3])
  assert s.system_v3_grind_1_derisk_futures == pytest.approx(-0.22 / 3)
  assert s.system_v3_2_stop_threshold_doom_futures == pytest.approx(0.35 / 3)


def test_futures_thresholds_untouched_at_3x():
  s = make_strategy(is_futures_mode=True, futures_mode_leverage=3.0)
  s.system_v3_2_derisk_level_1_futures = [-0.18, -0.35]
  s._scale_futures_thresholds_to_leverage()
  assert s.system_v3_2_derisk_level_1_futures == [-0.18, -0.35]


def test_protections_built_and_switchable():
  s = make_strategy()
  methods = [p["method"] for p in s._build_protections()]
  assert methods == ["CooldownPeriod", "MaxDrawdown", "LowProfitPairs"]
  s.hard_protections_enable = False
  assert s._build_protections() == []


def test_btc_informative_adds_roc_columns(monkeypatch):
  s = make_strategy()
  closes = [100.0] * 6 + [110.0] * 12 + [99.0]
  base = pd.DataFrame({"date": pd.date_range("2025-01-01", periods=len(closes), freq="4h"), "close": closes})
  monkeypatch.setattr(
    NostalgiaForInfinityX7Hardened.__bases__[0], "btc_informative_4h_indicators", lambda self, p, tf: base.copy()
  )
  out = s.btc_informative_4h_indicators("BTC/USDT", "4h")
  assert out["BTC_ROC_6"].iloc[-1] == pytest.approx(99.0 / 110.0 - 1.0)
  assert out["BTC_ROC_18"].iloc[-1] == pytest.approx(99.0 / 100.0 - 1.0)
