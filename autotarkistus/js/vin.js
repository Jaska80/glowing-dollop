/* Autoröntgen – paikallinen VIN/rekkari-tulkki. Ei verkkoa, ei riippuvuuksia.
   Lähteet: ISO 3779 (tarkistusnumero, WMI-maakoodit), valmistajien NHTSA Part 565 -ilmoitukset (Tesla),
   yleisesti tunnetut WMI-koodit. Taulukot ovat tarkoituksella suppeat ja merkitty "arvio" siellä,
   missä valmistaja ei noudata yhdenmukaista koodausta. */
(function (global) {
  'use strict';

  const TRANSLIT = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
  const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];

  /** Mallivuosikirjain (pos 10). Kiertää 30 vuoden välein: A=1980/2010, B=1981/2011 ... Y=2000/2030, 1=2001/2031 ... 9=2009/2039 */
  const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

  /** Maaryhmät WMI:n 1. merkin (ja osin 2.) mukaan. Vain yleisimmät. */
  const REGIONS = [
    [/^[A-C]/, 'Afrikka'],
    [/^J/, 'Japani'], [/^K[L-R]/, 'Etelä-Korea'], [/^L/, 'Kiina'],
    [/^M[A-E]/, 'Intia'], [/^M[F-K]/, 'Indonesia'], [/^M[L-R]/, 'Thaimaa'],
    [/^N[L-R]/, 'Turkki'], [/^P[L-R]/, 'Malesia'], [/^R[L-R]/, 'Taiwan'],
    [/^S[A-M]/, 'Iso-Britannia'], [/^S[N-T]/, 'Saksa (ent. DDR)'], [/^S[U-Z]/, 'Puola'],
    [/^T[A-H]/, 'Sveitsi'], [/^T[J-P]/, 'Tšekki'], [/^T[R-V]/, 'Unkari'], [/^TW/, 'Portugali'],
    [/^U[5-7]/, 'Slovakia'], [/^UU/, 'Romania'], [/^UH/, 'Tanska'],
    [/^V[A-E]/, 'Itävalta'], [/^V[F-R]/, 'Ranska'], [/^V[S-W]/, 'Espanja'], [/^V[X-Z0-2]/, 'Serbia/Kroatia'],
    [/^W/, 'Saksa'],
    [/^X[L-M]/, 'Alankomaat'], [/^X[S-W]/, 'Venäjä'], [/^X[3-9]/, 'Venäjä'],
    [/^Y[A-E]/, 'Belgia'], [/^Y[F-K]/, 'Suomi'], [/^Y[S-W]/, 'Ruotsi'],
    [/^Z[A-R]/, 'Italia'],
    [/^[1,4,5]/, 'USA'], [/^2/, 'Kanada'], [/^3/, 'Meksiko'], [/^6/, 'Australia'], [/^7[A-E]/, 'Uusi-Seelanti'], [/^7[F-Z]/, 'USA'],
    [/^8/, 'Argentiina/Chile'], [/^9/, 'Brasilia'],
  ];

  /** Tunnettuja WMI-koodeja. Avain 3 merkkiä. */
  const WMI = {
    // Tesla
    '5YJ': ['Tesla', 'Fremont, Kalifornia (USA)'], '7SA': ['Tesla', 'USA (Austin/Fremont)'], '7G2': ['Tesla', 'USA (Semi/Cybertruck)'],
    'LRW': ['Tesla', 'Shanghai (Kiina)'], 'XP7': ['Tesla', 'Grünheide/Berlin (Saksa)'], 'SFZ': ['Tesla (Roadster, Lotus-kori)', 'Iso-Britannia'],
    // Fiat / Stellantis
    'ZFA': ['Fiat', 'Italia'], 'ZFF': ['Ferrari', 'Italia'], 'ZAR': ['Alfa Romeo', 'Italia'], 'ZLA': ['Lancia', 'Italia'], 'ZAM': ['Maserati', 'Italia'],
    '3C3': ['Fiat (Chrysler de México)', 'Toluca, Meksiko'], '3C4': ['Chrysler/Dodge (Meksiko)', 'Meksiko'],
    '1C3': ['Chrysler', 'USA'], '1C4': ['Chrysler/Jeep', 'USA'], '1C6': ['Ram', 'USA'], '2C3': ['Chrysler', 'Kanada'], '1J4': ['Jeep', 'USA'], '1B3': ['Dodge', 'USA'], '2B3': ['Dodge', 'Kanada'],
    'VF3': ['Peugeot', 'Ranska'], 'VF7': ['Citroën', 'Ranska'], 'VR3': ['Peugeot', 'Ranska'], 'VR7': ['Citroën/DS', 'Ranska'], 'VR1': ['DS', 'Ranska'],
    'W0L': ['Opel', 'Saksa'], 'W0V': ['Opel', 'Saksa'], 'VXK': ['Opel (PSA-pohja)', 'Ranska'],
    // VAG
    'WVW': ['Volkswagen (henkilöautot)', 'Saksa'], 'WVG': ['Volkswagen (SUV/MPV)', 'Saksa'], 'WV1': ['Volkswagen hyötyajoneuvot', 'Saksa'], 'WV2': ['Volkswagen hyötyajoneuvot (bussi/Multivan)', 'Saksa'],
    'WAU': ['Audi', 'Saksa'], 'WUA': ['Audi Sport (quattro GmbH)', 'Saksa'], 'TRU': ['Audi', 'Unkari (Győr)'], 'WA1': ['Audi SUV', 'Saksa'],
    'TMB': ['Škoda', 'Tšekki'], 'VSS': ['SEAT', 'Espanja'], 'VSZ': ['Cupra/SEAT', 'Espanja'], 'WP0': ['Porsche', 'Saksa'], 'WP1': ['Porsche SUV', 'Saksa'],
    // BMW / Mini
    'WBA': ['BMW', 'Saksa'], 'WBS': ['BMW M', 'Saksa'], 'WBY': ['BMW i', 'Saksa'], 'WBX': ['BMW SUV', 'Saksa'], 'WMW': ['MINI', 'Iso-Britannia/Saksa'], '5UX': ['BMW SUV', 'USA (Spartanburg)'], '5YM': ['BMW M SUV', 'USA'],
    // Mercedes
    'WDB': ['Mercedes-Benz', 'Saksa'], 'WDC': ['Mercedes-Benz SUV', 'Saksa'], 'WDD': ['Mercedes-Benz', 'Saksa'], 'W1K': ['Mercedes-Benz', 'Saksa'], 'W1N': ['Mercedes-Benz SUV', 'Saksa'], 'W1V': ['Mercedes-Benz hyötyajoneuvot', 'Saksa'], 'WMX': ['Mercedes-AMG', 'Saksa'], '4JG': ['Mercedes-Benz SUV', 'USA (Tuscaloosa)'],
    // Volvo / Polestar
    'YV1': ['Volvo', 'Ruotsi'], 'YV4': ['Volvo SUV', 'Ruotsi/Belgia'], 'YV2': ['Volvo Trucks', 'Ruotsi'], 'LYV': ['Volvo', 'Kiina'], 'LPS': ['Polestar', 'Kiina'], 'YVV': ['Polestar', 'Ruotsi'], 'YS3': ['Saab', 'Ruotsi'],
    // Japani
    'JT': null, 'JTD': ['Toyota', 'Japani'], 'JTE': ['Toyota', 'Japani'], 'JTH': ['Lexus', 'Japani'], 'JTJ': ['Lexus', 'Japani'], 'JTM': ['Toyota', 'Japani'], 'JTN': ['Toyota', 'Japani'], 'SB1': ['Toyota', 'Iso-Britannia (Burnaston)'], 'NMT': ['Toyota', 'Turkki'], 'VNK': ['Toyota', 'Ranska (Valenciennes)'],
    'JHM': ['Honda', 'Japani'], 'SHH': ['Honda', 'Iso-Britannia'], 'JH4': ['Acura', 'Japani'],
    'JM0': ['Mazda', 'Japani'], 'JMZ': ['Mazda', 'Japani'], 'JM1': ['Mazda', 'Japani'],
    'JN1': ['Nissan', 'Japani'], 'SJN': ['Nissan', 'Iso-Britannia (Sunderland)'], 'VSK': ['Nissan', 'Espanja'], 'JN8': ['Nissan SUV', 'Japani'],
    'JF1': ['Subaru', 'Japani'], 'JF2': ['Subaru SUV', 'Japani'], 'JMB': ['Mitsubishi', 'Japani'], 'JA3': ['Mitsubishi', 'Japani'], 'JA4': ['Mitsubishi SUV', 'Japani'],
    'JS1': ['Suzuki (MP)', 'Japani'], 'JSA': ['Suzuki', 'Japani'], 'TSM': ['Suzuki', 'Unkari'],
    // Korea
    'KMH': ['Hyundai', 'Etelä-Korea'], 'KM8': ['Hyundai SUV', 'Etelä-Korea'], 'TMA': ['Hyundai', 'Tšekki (Nošovice)'], 'KNA': ['Kia', 'Etelä-Korea'], 'KND': ['Kia SUV', 'Etelä-Korea'], 'KNE': ['Kia', 'Etelä-Korea'], 'U5Y': ['Kia', 'Slovakia (Žilina)'], 'U6Y': ['Kia', 'Slovakia'], 'KL1': ['Chevrolet (GM Korea)', 'Etelä-Korea'],
    // Ranska / muut
    'VF1': ['Renault', 'Ranska'], 'VF6': ['Renault Trucks', 'Ranska'], 'UU1': ['Dacia', 'Romania'], 'VNE': ['Renault', 'Ranska'],
    'WF0': ['Ford', 'Saksa'], 'WF1': ['Ford', 'Saksa'], '1FA': ['Ford', 'USA'], '1FM': ['Ford SUV', 'USA'], '1FT': ['Ford pickup', 'USA'], '3FA': ['Ford', 'Meksiko'], 'NM0': ['Ford', 'Turkki'],
    'SAJ': ['Jaguar', 'Iso-Britannia'], 'SAL': ['Land Rover', 'Iso-Britannia'], 'SAD': ['Jaguar', 'Iso-Britannia'],
    '1G1': ['Chevrolet', 'USA'], '1GC': ['Chevrolet pickup', 'USA'], '1G6': ['Cadillac', 'USA'], '2G1': ['Chevrolet', 'Kanada'], '1HG': ['Honda', 'USA'], '5FN': ['Honda', 'USA'], '4T1': ['Toyota', 'USA'], '5TD': ['Toyota', 'USA'],
    'LGX': ['BYD', 'Kiina'], 'LSJ': ['MG (SAIC)', 'Kiina'], 'L6T': ['Lynk & Co', 'Kiina'], 'LVV': ['Chery', 'Kiina'], 'LZW': ['SAIC-GM-Wuling', 'Kiina'], 'LFV': ['FAW-VW', 'Kiina'], 'LSV': ['SAIC-VW', 'Kiina'],
    'YK1': ['Valmet Automotive (sopimusvalmistus)', 'Uusikaupunki, Suomi'], 'YE4': ['Sisu', 'Suomi'],
  };

  const TESLA = {
    model: { S: 'Model S', '3': 'Model 3', X: 'Model X', Y: 'Model Y', R: 'Roadster', C: 'Cybertruck', T: 'Semi' },
    body: {
      A: '5-ovinen hatchback, vasen ohjaus (Model S)', B: '5-ovinen hatchback, oikea ohjaus (Model S)',
      C: 'MPV luokka E, vasen ohjaus (Model X)', D: 'MPV luokka E, oikea ohjaus (Model X)',
      E: '4-ovinen sedan, vasen ohjaus (Model 3)', F: '4-ovinen sedan, oikea ohjaus (Model 3)',
      G: 'MPV luokka D, vasen ohjaus (Model Y)', H: 'MPV luokka D, oikea ohjaus (Model Y)',
      J: 'Cybertruck / Semi -kori',
    },
    battery: {
      E: 'Sähkö, NMC/NCA-kenno (yleinen koodi 2014→)', F: 'Sähkö, LFP-kenno (litiumrautafosfaatti)',
      H: 'Korkea kapasiteetti (Model S 2012–2013: 85 kWh)', S: 'Standard-kapasiteetti (Model S 2012–2013: 60 kWh)',
      V: 'Ultra-kapasiteetti', R: 'Sähkö (Cybertruck/uudemmat)',
    },
    motor: {
      '1': 'Yksi moottori, standard (Model S/X)', '2': 'Kaksi moottoria, standard – "D" (Model S/X)',
      '3': 'Yksi moottori, performance (Model S/X)', '4': 'Kaksi moottoria, performance – "P…D" (Model S/X)',
      '5': 'Kaksi moottoria, P2 (Raven/Plaid-aikakausi)', '6': 'Kolme moottoria (Plaid)',
      A: 'Yksi moottori, standard (Model 3/Y)', B: 'Kaksi moottoria, standard (Model 3/Y)', C: 'Kaksi moottoria, performance (Model 3/Y)',
      D: 'Yksi moottori, standard (Model 3/Y, uudempi koodi)', E: 'Kaksi moottoria (Model 3/Y, uudempi koodi)', F: 'Kaksi moottoria, performance (uudempi koodi)',
    },
    plant: { F: 'Fremont, Kalifornia', P: 'Palo Alto (protot/varhainen tuotanto)', A: 'Austin, Texas', B: 'Grünheide (Berlin)', C: 'Shanghai', N: 'Reno, Nevada (Gigafactory 1)', T: 'Tilburg, Alankomaat (EU-loppukokoonpano Model S/X)', R: 'Research/Prototype' },
  };

  function clean(v) { return String(v || '').toUpperCase().replace(/[\s\-\.]/g, ''); }

  function detectType(raw) {
    const s = clean(raw);
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) return 'vin';
    if (/^[A-ZÅÄÖ]{1,3}\d{1,3}$/.test(s)) return 'plate';
    if (s.length >= 11 && /^[A-Z0-9]+$/.test(s)) return 'vin-partial';
    return 'unknown';
  }

  function checkDigit(vin) {
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const ch = vin[i];
      const v = /\d/.test(ch) ? Number(ch) : TRANSLIT[ch];
      if (v === undefined) return { valid: false, expected: null, reason: 'kielletty merkki ' + ch };
      sum += v * WEIGHTS[i];
    }
    const r = sum % 11;
    const expected = r === 10 ? 'X' : String(r);
    return { valid: vin[8] === expected, expected };
  }

  function regionFor(wmi) {
    for (const [re, name] of REGIONS) if (re.test(wmi)) return name;
    return 'tuntematon alue';
  }

  function modelYears(code) {
    const idx = YEAR_CODES.indexOf(code);
    if (idx < 0) return [];
    const base = 1980 + idx; // 1980..2009
    return [base, base + 30, base + 60].filter(y => y <= new Date().getFullYear() + 1);
  }

  function decodeTesla(vin) {
    const out = [];
    const m = TESLA.model[vin[3]]; if (m) out.push(['Malli', m]);
    const b = TESLA.body[vin[4]]; if (b) out.push(['Kori / ohjaus', b]);
    out.push(['Turvavarusteet (koodi)', vin[5] + ' – Teslan Part 565 -taulukon mukainen turvatyyny/-vyökoodi']);
    const bat = TESLA.battery[vin[6]]; if (bat) out.push(['Akku / käyttövoima', bat]);
    const mot = TESLA.motor[vin[7]]; if (mot) out.push(['Moottorit / voimansiirto', mot]);
    const pl = TESLA.plant[vin[10]]; if (pl) out.push(['Tehdas (pos 11)', pl]);
    out.push(['Sarjanumero', vin.slice(11)]);
    return out;
  }

  /** Fiat 500e (2013–2019, Toluca). Tunnettu VDS-kuvio 3C3CFFGE. Uusi 500e (2020→) on ZFA-alkuinen. */
  function decodeFiat(vin) {
    const out = [];
    if (vin.startsWith('3C3CFFGE')) {
      out.push(['Malli', 'Fiat 500e (1. sukupolvi, 24 kWh, 83 kW) – USA-markkinan auto, Meksikossa valmistettu']);
      out.push(['Huomio', 'Yksilö on todennäköisesti USA-tuontiauto. Tarkista autoveropäätös ja EU-tyyppihyväksynnän puuttuminen (yksittäishyväksyntä).']);
    } else if (vin.startsWith('3C3CFF')) {
      out.push(['Malli', 'Fiat 500 (USA-markkina, Toluca). VDS ' + vin.slice(3, 8)]);
    } else if (vin.startsWith('ZFA')) {
      out.push(['Malli', 'Fiat (Italia). Tyyppikoodi ' + vin.slice(3, 9) + ' – 2020→ sähkö-500e on tyyppiä 332']);
    }
    return out;
  }

  function decodeVin(raw) {
    const vin = clean(raw);
    const res = { vin, ok: vin.length === 17, fields: [], warnings: [], errors: [] };
    if (!res.ok) { res.errors.push('VIN on ' + vin.length + ' merkkiä, pitää olla 17.'); return res; }
    if (/[IOQ]/.test(vin)) res.errors.push('Sisältää kirjaimen I, O tai Q – ne eivät kuulu VIN-koodiin. Luku- tai kirjoitusvirhe?');

    const wmi = vin.slice(0, 3);
    const known = WMI[wmi] || null;
    const region = regionFor(wmi);
    res.wmi = wmi; res.region = region; res.manufacturer = known ? known[0] : null; res.plantHint = known ? known[1] : null;
    res.fields.push(['WMI (valmistaja)', wmi + (known ? ' – ' + known[0] : ' – ei paikallisessa taulukossa (NHTSA täydentää)')]);
    res.fields.push(['Valmistusmaa (WMI)', region + (known && known[1] ? ', ' + known[1] : '')]);
    if (wmi[2] === '9') res.warnings.push('WMI päättyy 9:ään: pienvalmistaja (<1000 autoa/v), tarkempi tunniste positioissa 12–14.');

    const cd = checkDigit(vin);
    res.checkDigit = cd;
    const naMaker = /^[1-5]/.test(vin) || /^(5YJ|7SA|LRW|XP7)/.test(vin);
    if (cd.valid) res.fields.push(['Tarkistusnumero (pos 9)', vin[8] + ' – täsmää']);
    else if (naMaker) res.errors.push('Tarkistusnumero ei täsmää (on ' + vin[8] + ', pitäisi olla ' + cd.expected + '). Pohjois-Amerikan valmistajilla (ja Teslalla) tämän pitää täsmätä → kirjoitusvirhe tai väärennetty VIN.');
    else res.warnings.push('Tarkistusnumero ei täsmää ISO 3779 -laskennalla (odotettu ' + cd.expected + '). Eurooppalaiset ja japanilaiset valmistajat eivät yleensä käytä tarkistusnumeroa, joten tämä ei yksin ole hälytys.');

    const years = modelYears(vin[9]);
    res.modelYears = years;
    if (years.length) {
      const likely = years.filter(y => y >= 2000);
      res.fields.push(['Mallivuosi (pos 10)', likely.length ? likely.join(' tai ') + ' (30 v kierto)' : years.join(' / ')]);
      if (!naMaker) res.warnings.push('Mallivuosikirjain on sitova vain Pohjois-Amerikan markkinoilla. Esim. BMW ja Mercedes eivät koodaa vuotta VIN:iin – luota ensirekisteröintipäivään.');
    }
    res.fields.push(['VDS (pos 4–8)', vin.slice(3, 8) + ' – malli/kori/moottori valmistajan omalla koodauksella']);
    res.fields.push(['VIS / sarjanumero (pos 10–17)', vin.slice(9)]);

    res.brandFields = [];
    if (/^(5YJ|7SA|LRW|XP7|7G2)/.test(vin)) { res.brand = 'tesla'; res.brandFields = decodeTesla(vin); }
    else if (/^(3C3|ZFA)/.test(vin)) { res.brand = 'fiat'; res.brandFields = decodeFiat(vin); }
    return res;
  }

  function parsePlate(raw) {
    const s = String(raw || '').toUpperCase().replace(/\s/g, '');
    const m = s.match(/^([A-ZÅÄÖ]{1,3})-?(\d{1,3})$/);
    if (!m) return { ok: false, plate: s, errors: ['Ei näytä suomalaiselta rekisteritunnukselta (muoto ABC-123).'] };
    const letters = m[1], digits = m[2];
    const notes = [];
    if (letters.length === 3 && digits.length === 3) notes.push('Normaali henkilö-/pakettiauton tunnus (1972→ sarja).');
    if (letters.length === 2) notes.push('2 kirjainta: usein moottoripyörä, mopo, traktori tai vanha sarja.');
    if (letters === 'CD') notes.push('CD = diplomaattikilpi.');
    if (/^[0-9]/.test(letters)) notes.push('Numero edessä: ei suomalainen muoto.');
    return { ok: true, plate: letters + '-' + digits, letters, digits, notes };
  }

  global.VINLIB = { detectType, decodeVin, parsePlate, clean, checkDigit, modelYears, WMI, TESLA };
})(window);
