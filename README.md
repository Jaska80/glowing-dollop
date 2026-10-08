# NFI X7 Hardened

Kovennettu riskikerros [NostalgiaForInfinityX7](https://github.com/iterativv/NostalgiaForInfinity)
-strategian päälle (freqtrade). Upstream-tiedosto on muuttamaton kopio; kaikki muutokset ovat
alaluokassa `user_data/strategies/NostalgiaForInfinityX7Hardened.py`, joten upstream-päivitys on
pelkkä tiedoston kopiointi.

**Lue ensin:** [docs/ANALYYSI.md](docs/ANALYYSI.md) – tunnetut ongelmat, skenaariot, muutokset,
backtest-vertailu ja vertailu "huipputreidaajien" leaderboard-lukuihin.

## Hakemistot

| Polku | Sisältö |
|---|---|
| `user_data/strategies/NostalgiaForInfinityX7.py` | Upstream NFI X7, commit `docs/NFI_UPSTREAM_COMMIT.txt` |
| `user_data/strategies/NostalgiaForInfinityX7Hardened.py` | Riskikerros (alaluokka) |
| `configs/hardened-live-example.json` | Esimerkkikonfiguraatio live/dry-ajoon, kaikki `hard_*`-parametrit |
| `configs/backtest-binance-spot.json` | Offline-backtest-konfiguraatio (40 paria, myös romahtaneet kolikot) |
| `tools/run_backtests.sh` | Ajaa perus-X7:n ja kovennetun version stressi-ikkunoiden yli |
| `tools/compare_results.py` | Tekee vertailutaulukon tuloksista |
| `tools/backtest_offline.py`, `tools/offline_markets.py` | Backtest ilman pörssiyhteyttä |
| `tests/test_hardened.py` | Yksikkötestit riskikerroksen suojille |
| `docs/backtest-results/` | Ajettujen vertailujen tulokset |

## Käyttö

```bash
python -m venv .venv && . .venv/bin/activate
pip install freqtrade ta-lib python-rapidjson pytest
python -m pytest tests -q

# data (Binance spot USDT, 5m/15m/1h/4h/1d) user_data/data/binance -hakemistoon, sitten:
freqtrade backtesting --userdir user_data --config configs/backtest-binance-spot.json \
  --strategy NostalgiaForInfinityX7Hardened --timerange 20250101-20250530 --enable-protections

# ilman pörssiyhteyttä:
python tools/offline_markets.py user_data/data/binance user_data/markets-binance-spot.json
FT_MARKETS=user_data/markets-binance-spot.json python tools/backtest_offline.py backtesting ...
```

Live/dry: kopioi `configs/hardened-live-example.json` → `user_data/config.json`, täytä
`configs/exampleconfig_secret.json` (API-avaimet, vain trade-oikeudet, ei nostoja) ja aja
`freqtrade trade`. Aja vähintään 2 viikkoa dry-run ennen oikeaa rahaa.

## Upstream-päivitys

```bash
curl -L -o user_data/strategies/NostalgiaForInfinityX7.py \
  https://raw.githubusercontent.com/iterativv/NostalgiaForInfinity/main/NostalgiaForInfinityX7.py
python -m pytest tests -q          # alaluokan oletukset vielä voimassa?
```

Lisenssi: upstream on GPL-3.0 (`LICENSE.NostalgiaForInfinity`), tämä repo samoin.
