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
├── js/issues_db.js            116 komponenttitason tyyppivikasääntöä (moottorikoodit, vaihteistot, akut, varusteet, alkuperä)
├── js/app.js                  raportti, riskipisteet, NHTSA-haut, verolaskuri, vertaisryhmä, export
├── server.js                  Node 18+ -palvelin: staattiset tiedostot, NHTSA-proxy + välimuisti, rekkariadapteri, huutokauppa-arkistoluotaimet
├── tools/build_peer_stats.py  Traficomin avoin data (CSV) → data/peer_stats.json
├── data/peer_stats.json       (generoitu, ei repossa)
└── data/fingerprints.json     (generoitu, ei repossa)
```

## Demo ilman asennusta

`demo/autorontgen-demo.html` on yksi tiedosto, joka sisältää kaiken ja toimii ilman verkkoa: esimerkkiautoille
(Tesla Model S 75D 2018, Fiat 500e 2016 USA-tuonti, Passat 2.0 TDI DSG 2012 Ruotsi) on valmis esimerkkidata.
Live-haut eivät toimi demossa; muille VIN-koodeille toimivat VIN-tulkki, riskiprofiili, verolaskuri ja linkit.
Rakennetaan uudelleen komennolla `python3 tools/build_demo.py`.

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
# yksilötason sormenjäljet haluamillesi malleille (pieni tiedosto):
python3 tools/build_peer_stats.py /polku/TieliikenneAvoinData.csv --fingerprint "TESLA|MODEL S,FIAT|500E"
#    → data/fingerprints.json
```

## Mitä raportti sisältää

| Kortti | Lähde | Verkko |
|---|---|---|
| Punaiset liput + riskipisteet | kaikki alla olevat yhdistettynä | – |
| **Yksilöllinen riskiprofiili** | 116 sääntöä täsmäytetään tämän auton kokoonpanoon: moottorikoodi (CAYC, N47, OM651…), vaihteistotyyppi (DQ200, Jatco CVT, PowerShift…), iskutilavuus, veto, akun koko (Tesla 85/90/75/100), VIN-positiot (Tesla LFP), varusteet (ilmajousitus, panoraama, matrix…), alkuperä (USA-tuonti), ajomäärä/v ja ikä. Jokainen osuma kertoo mitä tarkistaa ja mitä korjaus maksaa, ja *miksi* sääntö osui. | ei |
| **Onnettomuudet, lunastukset, kuvat** | palvelimen luotaimet hakevat VIN:n Copart/IAAI/bidfax/poctra/stat.vin -arkistoista; kuvahaut (Google/Yandex/Bing) VIN:llä ja rekkarilla; NMVTIS/Carfax/AutoCheck/carVertical/autoDNA; AVK ja vanhat suomalaiset ilmoitukset; kolarikorjauksen tunnistaminen paikan päällä | proxy + linkit |
| **Katsastushistoria** | ohjattu polku: Traficom ilmainen vs. maksullinen historia, "rekisteröintikatsastus kesken elinkaaren" -tulkinta, tuontimaan ilmainen katsastusrekisteri (SE/NO/DK/UK/EE/NL) suoraan vanhalla rekkarilla, odotettu km-lukema iän mukaan | linkit |
| **Avoimen datan sormenjälki** | merkki + malli + ensirekisteröintipäivä + väri + kunta rajaavat Traficomin avoimen datan usein yhteen riviin → yksilön viimeisin katsastuskilometri ilmaiseksi; hälyttää jos ilmoitettu lukema on pienempi | paikallinen JSON |
| VIN-tulkinta | paikallinen: tarkistusnumero, WMI/maa, mallivuosi (30 v kierto), Tesla Part 565 -koodit (malli, kori, akku, moottorit, tehdas), Fiat 500e USA-tunnistus | ei |
| NHTSA vPIC | 100+ kenttää: malli, akku kWh, moottorit, tehdas, turvavarusteet | live/proxy |
| Takaisinkutsut, omistajavalitukset, törmäystähdet | NHTSA (USA) – täysin relevantti Teslalle ja USA-tuontiautoille (esim. Fiat 500e 2013–19) | live/proxy |
| Rekisteritunnushaku | server.js-adapteri (kokeellinen) → muuten Traficom-linkki | proxy |
| Vertaisryhmä Suomessa | Traficomin avoin data: mediaani- ja kvartiilikilometrit, massa, CO2, väri, kunta | paikallinen JSON |
| Ajoneuvovero 2026 | Traficomin taulukko: sähkö perusvero 106,21 €/v (0 g), käyttövoimavero 1,9 c/pv/alkava 100 kg (diesel 5,5, kaasu 3,1) | ei |
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

## Miten riskiprofiili toimii (js/issues_db.js)

Jokaisella säännöllä on `match`-ehto, jonka kaikkien osien pitää täyttyä. Profiili kootaan VIN-tulkinnasta, NHTSA:sta,
rekkarihausta ja käsin syötetystä. Esimerkkejä:

```js
{ engine: ['CAY', 'CFFB', 'EA189'] }                       // moottorikoodin alku tai perhe (käsin: "EA189" riittää)
{ make: ['VOLKSWAGEN'], trans: 'kaksois|DSG', disp: [0.9, 1.6], years: [2008, 2020] }   // kuiva DQ200
{ make: ['TESLA'], model: 'MODEL (S|X)', kwh: [84, 86] }    // 85 kWh akku
{ make: ['TESLA'], tesla: { battery: ['F'] } }              // VIN pos 7 = F → LFP
{ fuel: ['diesel'], years: [2014, 2030] }                   // AdBlue/SCR
{ feat: ['ilmajousitus'] }  { origin: ['USA'], anyOf: ['importFlag'] }  { kmPerYear: [0, 8000] }  { ageMin: 8 }
```

Uuden säännön lisääminen on yksi objekti taulukkoon. Kun moottorikoodi puuttuu, raportti kertoo montako sääntöä jäi
tarkistamatta – koodi löytyy moottorin tarrasta, osasta rekisteröintitodistuksia tai Biltema/Motonet-rekkarihausta.

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
- Huutokauppa-arkistoluotaimet (`PROBES` server.js:ssä) ovat kokeellisia: sivustot vaihtavat osoitteita ja osa estää botit.
  Tulos "ei tarkistettu" tarkoittaa että avaat linkin itse. Osuma on vahva signaali, "ei osumaa" ei todista mitään.
- Tyyppivikasäännöt ovat yleistyksiä laajasti dokumentoiduista vioista, eivät väite yksittäisen auton kunnosta. Vuosirajat
  ja moottorikoodilistat on koottu muistinvaraisesti – jos tiedät paremmin, korjaa sääntö ja kerro.

## Ideoita jatkoon

- Sääntökannan laajennus: käyttäjien omat havainnot (lomake → JSON), Traficomin vikatilaston automaattinen linkitys ikäluokkaan.
- OCR rekisteröintitodistuksesta → profiili täyttyy kuvasta.

- Rekisterikilven kirjainsarja → rekisteröintivuoden arvio (vaatii sarjataulukon 2010-luvulta; ei löytynyt luotettavaa lähdettä).
- Traficomin katsastuksen vikatilaston (Excel) jauhaminen JSONiksi samaan tapaan kuin mittarilukemat → "hylkäys-% tälle mallille/iälle".
- OBD-lukeman (akun SOH) syöttö ja vertailu malliodotukseen (Tesla 75D, 500e 24 kWh).
- Vero.fi:n autoveropäätös-Excelit → "mitä autoveroa tästä mallista on maksettu" tuontiautoille.
