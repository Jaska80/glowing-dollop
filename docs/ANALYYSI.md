# NFI X7 – analyysi, tunnetut ongelmat ja kovennettu versio

Päiväys: 2026-10-08. Upstream: NostalgiaForInfinityX7 v17.5.157, commit `7070de2`.

## 0. Suoraan asiaan: "lyömätöntä" strategiaa ei ole

Pyysit lyömätöntä. Sellaista ei voi tehdä, eikä kukaan rehellinen sitä lupaa. Mitä *voi* tehdä:

1. Rajata häntäriski niin, että yksi huono viikko ei vie tiliä (NFI:n oletuksilla voi).
2. Korjata tunnetut logiikkavirheet.
3. Mitata rehellisesti, myös romahtaneilla kolikoilla, ei vain selviytyjillä.

Tämä repo tekee nuo kolme. Tulos on sama NFI X7, mutta kattotilanteet on katkaistu.

## 1. Mitä NFI X7 oikeasti tekee

- 5 min kynttilät, 100+ entry-signaalia (tagit 1–173, shortit 501–671), monta "moodia"
  (normal, pump, quick, rebuy, rapid, grind, top coins, scalp).
- Ei stop lossia. `stoploss = -0.99`, `system_v3_2_stops_enable = False`,
  `u_e_stops_enable = False`, ja `confirm_trade_exit()` **estää** freqtraden oman stop_loss-exitin.
  Ainoa tappiollinen poistumispolku on *derisk-portaat*: myy 20 % / 30 % / 50 % alkupanoksesta
  kun positio on −12 % / −18 % / −20 % (spot; futures-arvot jaetaan vivulla).
- Grind/DCA: kun hinta laskee 6–10 %, ostetaan lisää (5 "grind-klusteria" + rebuy + buyback),
  yhteensä jopa 1× alkupanos lisää per positio.
- Backtestit upstreamissa näyttävät 85–97 % voittoprosenttia ja 1–15 % drawdownia, mutta
  **blacklist sulkee pois 40 delistattua/romahtanutta kolikkoa** (LUNA, FTT, OM, ALPACA, WAVES…).
  Fork [orreland/nfi-x7safe](https://github.com/orreland/nfi-x7safe) palautti ne universumiin:
  tuotto putosi +191 % → −4,4 % ja max DD 3,7 % → 37,7 %. Tämä on NFI:n suurin "tiedossa oleva
  ongelma": survivorship-harha.

## 2. Tunnetut ongelmat (GitHub-issuet + koodista varmistettu)

| # | Ongelma | Lähde | Varmistus koodista | Korjaus tässä repossa |
|---|---|---|---|---|
| 1 | Ei minkäänlaista kovaa tappiorajaa; "bagit" voivat maata −50…−90 % kuukausia | issue [#1038](https://github.com/iterativv/NostalgiaForInfinity/issues/1038), orreland-fork | `long_exit_stoploss` v3_2-haara: `system_v3_2_stops_enable=False`; `confirm_trade_exit` palauttaa False stop_lossille | `exit_hard_stop` koko positiolle (−25 % alkupanoksesta spot, −18 % futures), `exit_hard_time_stop` (30 pv + tappiolla) |
| 2 | Futures: likvidaation lähellä ei ole exitiä, vain RSI-ehdollinen grind-osto | #1038 (PLAY −57 %, ZEC) | `confirm_trade_exit` vetoaa stopin; likvidaatiotarkistus vain backtestissä | `exit_hard_liq_guard` kun hinta ≤10 % likvidaatiohinnasta |
| 3 | Derisk-myynti ja grind-osto sekunneissa samaan hintaan (kaksi kertaa spread + palkkiot) | issue [#1036](https://github.com/iterativv/NostalgiaForInfinity/issues/1036) | adjust_trade_position ei tiedä edellisestä tilauksesta mitään | 60 min cooldown ostoille derisk-täytön jälkeen |
| 4 | Markkinalaajuinen romahdus (10.10.2025): botti avaa longeja koko matkan alas | issue [#1325](https://github.com/iterativv/NostalgiaForInfinity/issues/1325), #681 | NFI:n protections ovat parikohtaisia indikaattoriehtoja, ei portfoliotason katkaisijaa | BTC-crash guard (−8 %/24 h tai −15 %/72 h BTC 4h): ei uusia longeja, ei grind-ostoja. Lisäksi freqtrade MaxDrawdown/CooldownPeriod/LowProfitPairs |
| 5 | Futures-kynnykset ovat marginaalitilassa ja olettavat 3× vivun; eri vipu siirtää riskiä hiljaa | issue #1035 | `profit_stake < slice_amount * threshold / trade_leverage` | Kynnykset skaalataan vivulla (3× → L×) automaattisesti |
| 6 | `grind_mode_first_entry_stop_threshold_futures` ei lueta koskaan (ternary lukee `_spot` molemmissa haaroissa) | issue #1245 | rivit 52525–52527 ja 76055–76057 | futures-arvo kopioidaan spot-attribuuttiin futures-tilassa |
| 7 | Flash crash / ohut kirja (BOME): ohjelmallinen stop ei ehdi | issue #681 | `max_slippage = 0.02` sallii 2 % huonomman täytön | `max_slippage` 1 %; pair knife guard (−15 %/24 h) estää grind-ostot putoavaan puukkoon |
| 8 | Survivorship-harha blacklistissä | orreland-fork | 40 paria blacklistissä kaikki delistattu | Backtest-universumiin lisätty OM, LUNA, FTT, ALPACA, WAVES, CELR, BAKE |
| 9 | Grind-positiot blokkaavat slotit viikkoja (issue #1037), max_open_trades staattinen | #1037 | – | Time stop vapauttaa slotit; upstreamin `bad_trade_controller` (oletuksena pois) kytketty päälle |
| 10 | Tokenisoitu osake-split luetaan −67 % romahdukseksi ja ostetaan "dippi" | upstream blacklist-kommentti (KIOXIA) | indikaattorit eivät erota corporate actionia | knife guard estää grind-ostot; uudet entryt vaativat edelleen blacklist-ylläpidon |

Korjaamatta jätetyt (tietoisesti):

- NFI:n sadat entry-signaalit ja niiden parametrit. Niiden "optimointi" olisi ylisovitusta.
- Upstreamin backtest-vs-live-erot (issue #1234): limit-tilaukset `price_side: other` täyttyvät
  backtestissä aina; livessä eivät. Tätä ei voi korjata strategiassa, vain odotuksissa.

## 3. Skenaariot, joita vasten koventaminen on mietitty

| Skenaario | Mitä X7 tekee oletuksena | Mitä kovennettu tekee |
|---|---|---|
| Hidas karhumarkkina (2022) | Grindaa alas, bagit kasvavat, pääoma lukossa | Time stop 30 pv, hard stop −25 %, MaxDrawdown pysäyttää uudet entryt 24 h |
| Flash crash −20 % päivässä (LUNA 5/2022, 10.10.2025) | Ostaa koko matkan, futuresissa likvidoituu | BTC-crash guard: ei uusia longeja eikä grindejä; liq guard sulkee ennen likvidaatiota |
| Yksittäisen kolikon romahdus (OM −90 % 13.4.2025, ALPACA) | Derisk myy 100 % alkupanoksen vasta −20 %:ssa; grind ostaa välissä lisää | Knife guard estää grindin, hard stop sulkee −25 %:ssa |
| Pitkä sivuttaisliike (chop) | Toimii hyvin, tämä on NFI:n paras ympäristö | Sama; cooldown 30 min estää saman parin pyörittämisen |
| Pump & dump | Pump-moodi myy nopeasti; dumpissa jää bagiin | Hard stop |
| Pörssi delistaa parin kesken kaupan | Freqtrade ei osaa sulkea, positio jää | Ei korjattavissa strategiassa → blacklist-ylläpito + `AgeFilter`/`VolumePairList` |
| Vipu ≠ 3× futuresissa | Derisk-portaat siirtyvät hintatilassa (1×: −35 % vs −11,7 %) | Skaalaus |
| Botti kaatuu / verkko poikki | Positiot ilman stoppia pörssissä | Ei korjattavissa strategiassa. Suositus: `stoploss_on_exchange` hätästopiksi erillisellä `stoploss`-arvolla jos haluat, muuten valvonta |

## 4. Backtest-vertailu

Ympäristö: Binance spot USDT, 40 paria (myös romahtaneet), 6 slottia, 10 000 USDT, fee 0,1 %,
freqtrade 2026.9, data DigiTuccar/HistoricalDataForTradeBacktest (2017–05/2025). Protections
päällä molemmissa (perus-X7:llä ei ole protection-määrittelyjä, joten lippu ei vaikuta siihen).

Ikkunat valittu tarkoituksella pahimmiksi: 2022-05→11 (LUNA, kesäkuun crash, FTT), 2024 H1 ja H2
(nousu + chop), 2025-01→05 (helmi–huhtikuun lasku, OM-romahdus).

TULOKSET_TAULUKKO

Huomioita tulkintaan:

- "profit_incl_open" ja "max_dd_wallet" sisältävät avoimet positiot markkinahintaan. NFI:n
  perusversion luvut näyttävät hyviltä vain closed-trades-mittareilla, koska bagit eivät koskaan
  sulkeudu. Katso wallet-pohjaista drawdownia.
- Yksi backtest-ikkuna ei todista mitään. Vasta jos kovennettu versio on **systemaattisesti**
  matalampi drawdowniltaan menettämättä kohtuuttomasti tuottoa, sitä kannattaa ajaa.

## 5. Vertailu "supermenestyneisiin treidaajiin" (leaderboardit)

Rehellinen vastaus: suoraa vertailua ei voi tehdä kunnolla, ja syyt ovat tärkeämpiä kuin luvut.

1. **Dataa ei ole saatavilla luotettavasti.** Binance Futures Leaderboard näyttää vain top-100
   ROI/PnL-listan; drawdownia ja positiokokoa ei julkaista. Bybitin ja OKX:n copy-trading-sivut
   näyttävät omat, auditoimattomat mittarinsa. Tämä sandbox ei pääse pörssi-API:hin, joten
   luvut alla ovat julkisista lähteistä.
2. **Binancen ROI-kaava** = tuotto / (100 USDT + alkusaldo + talletukset). Pienellä tilillä ja
   50× vivulla ROI on tuhansia prosentteja. Se ei ole vertailukelpoinen 10 000 USDT spot-botin
   kanssa.
3. **Survivorship-harha on sama kuin NFI:n blacklistissä.** Leaderboard on kuva niistä, jotka
   eivät vielä ole räjähtäneet. Akateeminen tutkimus ("Stranger Danger?", CHI 2024) Bybitin ja
   TraderWagonin leaderboardeista: sijoitus listalla ei ennusta seuraajien tuottoa.
4. **Seuraajien tulokset:** yieldfund.comin 100 236 copy-trading-tulosta kattava (vendorin oma,
   ei vertaisarvioitu) 90 päivän aineisto: 48,5 % seuraajista plussalla; Bybitillä 43,7 %,
   Binancella 66,5 %. Eli puolet häviää rahaa seuratessaan "huippuja".

Mitä sitten voi verrata? Riskikorjattuja mittareita, jotka eivät riipu vivusta:

| Mittari | Leaderboard-huiput (julkiset väitteet) | NFI X7 upstream-CI | Tämä repo (tavoite) |
|---|---|---|---|
| Max drawdown | Harvoin julkaistu; kun on, 30–60 % | ≤15 % closed-trades (CI-raja), 37,7 % kun romahtaneet mukana | ≤15 % wallet-pohjaisesti myös romahtaneilla |
| Voittoprosentti | 60–80 % | 85–97 % | 80–95 % (hard stop lisää pieniä tappioita) |
| Kuukausituotto | 10–100 %+ vivulla | 1–10 % spot | 1–8 % spot, vähemmän hajontaa |
| Elinikä | Viikkoja–kuukausia listalla | 2021– | – |

Johtopäätös: leaderboard-ROI ei ole tavoite vaan varoitus. Jos haluat verrata botin tuloksia
johonkin, vertaa BTC:n buy&holdiin samalla ajalla (taulukossa "market_change") ja omaan
max-drawdown-sietoosi.

## 6. Mitä tekisin tällä käytännössä (Jaakko)

1. Dry-run 2–4 viikkoa Binance spotilla, `max_open_trades 6`, `stake unlimited`, kovennettu versio.
2. Oikealla rahalla aloita summalla, jonka −20 % ei haittaa. Spot, ei futures. Futures-tilassa
   NFI:n derisk-portaat + likvidaatio ovat edelleen paljon riskialttiimmat kuin spot.
3. Seuraa kolmea lukua viikoittain: wallet-pohjainen drawdown, avointen positioiden ikä,
   `exit_hard_*`-exitien määrä. Jos hard-stoppeja tulee paljon, markkina on NFI:lle väärä –
   silloin botti kiinni, ei parametrien säätö.
4. Päivitä upstream kuukausittain (README) ja aja testit.

## Lähteet

- Upstream: https://github.com/iterativv/NostalgiaForInfinity (issuet #681, #1035, #1036, #1037, #1038, #1084, #1234, #1245, #1325, #1416)
- orreland/nfi-x7safe: https://github.com/orreland/nfi-x7safe
- Binance Leaderboard FAQ: https://www.binance.com/en/support/faq/introduction-to-binance-futures-leaderboard-a507bdb81ad0464e871e60d43fd21526
- "Stranger Danger? Investor Behavior and Incentives on Cryptocurrency Copy-Trading Platforms": https://dl.acm.org/doi/full/10.1145/3613904.3642715
- yieldfund.com 90 päivän copy-trading-aineisto: https://yieldfund.com/is-copy-trading-profitable-a-90-day-multi-exchange-study
- Data: https://github.com/DigiTuccar/HistoricalDataForTradeBacktest
