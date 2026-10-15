# Autoröntgen – rekkari/VIN-tarkistus

CarVertical/Carfax-henkinen työkalu, joka kokoaa **ilmaiset** lähteet yhdeksi raportiksi ja kertoo rehellisesti,
mitä Suomessa ei saa ilmaiseksi ja mistä sen saa. Ei riippuvuuksia: yksi HTML-sivu + JS, valinnainen Node-palvelin,
valinnainen Python-skripti Traficomin avoimelle datalle.

```
autotarkistus/
├── index.html                 sivu (avaa suoraan tai palvelimen kautta)
├── css/style.css
├── js/vin.js                  paikallinen VIN-tulkki: ISO 3779 tarkistusnumero, WMI-taulukko, mallivuosi, Tesla- ja Fiat-dekooderit
├── js/sources.js              lähderekisteri ("kaikki kolot") – ajaa sekä lähdekartan että syvälinkit
├── js/app.js                  raportti, riskipisteet, NHTSA-haut, verolaskuri, vertaisryhmä, export
├── server.js                  Node 18+ -palvelin: staattiset tiedostot, NHTSA-proxy + välimuisti, rekkariadapteri
├── tools/build_peer_stats.py  Traficomin avoin data (CSV) → data/peer_stats.json
└── data/peer_stats.json       (generoitu, ei repossa)
```

## Käyttö

```bash
cd autotarkistus
node server.js              # → http://localhost:8787
```

Ilman palvelinta `index.html` toimii suoraan selaimessa (VIN-tulkki, verolaskuri, linkit, muistilistat).
NHTSA-haut selaimesta suoraan toimivat vain jos rajapinta sallii CORS-pyynnön; palvelin kiertää tämän.

Vertaisryhmätilasto (mittarilukemat Suomessa samalle merkki/malli/vuosi-ryhmälle):

```bash
# 1) lataa zip: https://avoindata.suomi.fi/data/fi/dataset/ajoneuvojen-avoin-data  (~1 GB CSV, CC BY 4.0)
# 2)
python3 tools/build_peer_stats.py /polku/TieliikenneAvoinData.csv --as-of 2026-03-31
#    → data/peer_stats.json  (ryhmät joissa ≥20 autoa; --min-n muuttaa)
```

## Mitä raportti sisältää

| Kortti | Lähde | Verkko |
|---|---|---|
| Punaiset liput + riskipisteet | kaikki alla olevat yhdistettynä | – |
| VIN-tulkinta | paikallinen: tarkistusnumero, WMI/maa, mallivuosi (30 v kierto), Tesla Part 565 -koodit (malli, kori, akku, moottorit, tehdas), Fiat 500e USA-tunnistus | ei |
| NHTSA vPIC | 100+ kenttää: malli, akku kWh, moottorit, tehdas, turvavarusteet | live/proxy |
| Takaisinkutsut, omistajavalitukset, törmäystähdet | NHTSA (USA) – täysin relevantti Teslalle ja USA-tuontiautoille (esim. Fiat 500e 2013–19) | live/proxy |
| Rekisteritunnushaku | server.js-adapteri (kokeellinen) → muuten Traficom-linkki | proxy |
| Vertaisryhmä Suomessa | Traficomin avoin data: mediaani- ja kvartiilikilometrit, massa, CO2, väri, kunta | paikallinen JSON |
| Ajoneuvovero 2026 | Traficomin taulukko: sähkö perusvero 106,21 €/v (0 g), käyttövoimavero 1,9 c/pv/alkava 100 kg (diesel 5,5, kaasu 3,1) | ei |
| Tunnetut mallikohtaiset ongelmat | kuratoitu muistilista (Tesla S/3/X/Y, Fiat 500e) | ei |
| Syvälinkit | 25 lähdettä, URL täytetään tunnistetulla autolla | – |

Lisäksi: tulostus/PDF, JSON-vienti, jaettava linkki (`?q=VIN`), käsin täydennys (tallentuu selaimeen) jolloin
kaikki kortit toimivat pelkällä rekkarilla kun merkki/malli/vuosi on katsottu Traficomista.

## Lähdekartta – kaikki kolot (lyhyesti; täysi taulukko sivun välilehdellä)

**Suomi, viralliset**
- Traficom Oma asiointi: tekniset + verotiedot + katsastus + liikennekäyttö **ilmaiseksi** tunnistautuneena; omistaja-/mittarihistoria maksullista. Ei rajapintaa → syvälinkki.
- Traficom avoin data: koko kanta CSV:nä, sis. viimeisin katsastuksen mittarilukema, **ei** rekkaria/VIN:iä → vertaisryhmätilasto.
- Traficom takaisinkutsut (merkkitaso), katsastuksen vikatilastot (mallitaso), ajoneuvoveron taulukot.
- Verohallinto: autoveropäätökset (tuontiauto!), käytettyjen hintatietopalvelu.
- Liikennevakuutuskeskus: vakuutusyhtiö rekkarilla vahinkotilanteessa.

**USA, ilmaiset rajapinnat (ei avainta)**: NHTSA vPIC-dekooderi, recalls, complaints, SafetyRatings.

**Valmistajat**: Tesla VIN-takaisinkutsuhaku, tesla-info.com (optiokoodit, vanhat EU-ilmoitukset), Mopar VIN-haku (USA-Fiat), EV Database.

**EU**: Safety Gate (RAPEX), EUCARIS (vain viranomaiset/maahantuojat).

**Kaupalliset Suomessa**: Biltema/Motonet rekkarihaku (varaosat; ei dokumentoitua APIa), Nettiauto/Tori hintavertailu,
hakukone `"ABC-123"` lainausmerkeissä (vanhat ilmoitukset, kolariautot), carVertical/rekkari.fi/tekstiviestihaut (maksullisia).
KKV varoittaa "ilmaisista hinta-arvioista" – lue hinta ennen tunnuksen syöttöä.

## Rehellinen tila

Rakennusympäristön verkko oli rajoitettu, joten **rajapintoja ei ajettu oikeaa dataa vastaan**. Mitä tämä tarkoittaa:

- NHTSA:n osoitteet ja kenttänimet ovat virallisesta dokumentaatiosta ja vastaavat laajasti käytettyjä kirjastoja. Jos selain
  ilmoittaa CORS-virheen, käytä `server.js`:ää – se tekee pyynnöt palvelinpuolella.
- `server.js`:n Biltema-adapteri on **arvaus** sivuston käyttämästä sisäisestä hausta. Jos se ei vastaa, raportti sanoo sen
  ääneen ja ohjaa Traficomiin. Oikea osoite ja kentät löytyvät selaimen DevTools → Network -välilehdeltä, kun teet haun
  biltema.fi:ssä; korjaa `REG_ADAPTERS`-taulukkoon. Tee hakuja vain omaan tarpeeseen.
- Traficomin avoimen datan sarakenimet (`merkkiSelvakielinen`, `kaupallinenNimi`, `ensirekisterointipvm`, `matkamittarilukema`,
  `omamassa`, `Co2`, `vari`, `kunta`, `kayttovoima`) ovat version 5.x mukaiset; skripti etsii ne otsikkoriviltä ja kertoo jos puuttuvat.
- Verotaulukon luvut ovat 1.1.2026 voimaan tulleet (sähkö 1,5→1,9 c; perusvero min 53,29→106,21 €/v). Polttomoottoriauton
  perusvero CO2:n mukaan katsotaan Traficomin taulukosta – sitä ei ole kopioitu tähän, koska sitä ei saatu varmistettua.
- Tesla-VIN-koodit (akku/moottori) vaihtelevat mallivuosittain; dekooderi kertoo yleisimmän tulkinnan, NHTSA vPIC on auktoriteetti.

## Ideoita jatkoon

- Rekisterikilven kirjainsarja → rekisteröintivuoden arvio (vaatii sarjataulukon 2010-luvulta; ei löytynyt luotettavaa lähdettä).
- Traficomin katsastuksen vikatilaston (Excel) jauhaminen JSONiksi samaan tapaan kuin mittarilukemat → "hylkäys-% tälle mallille/iälle".
- OBD-lukeman (akun SOH) syöttö ja vertailu malliodotukseen (Tesla 75D, 500e 24 kWh).
- Vero.fi:n autoveropäätös-Excelit → "mitä autoveroa tästä mallista on maksettu" tuontiautoille.
