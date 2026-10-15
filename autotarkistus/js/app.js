/* Autoröntgen – sovelluslogiikka. Toimii myös suoraan file:// -tiedostona; server.js laajentaa (proxy, välimuisti). */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => n == null || isNaN(n) ? '–' : Number(n).toLocaleString('fi-FI');
  const eur = (n) => Number(n).toLocaleString('fi-FI', { style: 'currency', currency: 'EUR' });

  /* ---------- Verotaulukko 2026 (Traficom). Vain vahvistetut luvut; muut → linkki Traficomin laskuriin. ---------- */
  const TAX_2026 = {
    perusvero_min_eur_year: 106.21,         // 0 g/km WLTP → 29,10 c/pv
    kayttovoima_c_per_day_100kg: { sahko: 1.9, diesel: 5.5, kaasu: 3.1, bensiini: 0 },
  };

  /* ---------- Mallikohtaiset tunnetut ongelmat (ostajan muistilista). Lähde: NHTSA-takaisinkutsut, omistajafoorumit, Traficomin katsastustilasto. ---------- */
  const KNOWN_ISSUES = {
    'TESLA|MODEL S': [
      ['2012–2018', 'MCU1 (Tegra) eMMC-flashmuistin kuluminen → näyttö pimenee. NHTSA-takaisinkutsu 21V-035. Tarkista onko MCU vaihdettu/päivitetty (daughterboard).'],
      ['2012–2020', 'Ovenkahvojen mikrokytkimet ja vaijerit – yleinen vika, ~300–600 €/kahva.'],
      ['2012–2020', 'Ilmajousituksen kompressori ja jalat (jos Smart Air Suspension). Kuuntele kompressorin käyntiaikaa.'],
      ['2016–2019', '12 V akku kestää 3–4 v. Vaihtokustannus pieni, mutta jättää auton tielle.'],
      ['75D 2016–2019', 'Akku: pyydä latausnäyttö 100 %:iin, vertaa toimintamatkaa (uutena 75D ≈ 490 km NEDC / ~416 km EPA). >12 % pudotus on paljon.'],
      ['kaikki', 'Takavetomoottorin "milling noise" (vanha pieni DU) ja etumoottorin laakeri. Tesla vaihtoi takuuseen – kysy huoltohistoria Teslan appista.'],
      ['kaikki', 'Tuontiautoissa (USA/Norja/Saksa) tarkista: Supercharger-oikeus (SC01 ilmainen vai ei), Autopilot-lisenssi siirtyy omistajalle, EU-tyyppihyväksyntä.'],
    ],
    'TESLA|MODEL 3': [['2017–2023', 'Traficom 2023: Model 3:n katsastushylkäys-% 31,6 – yleisin syy alatukivarsien nivelet ja jarrut (ruostuvat vähäisellä käytöllä). Koeaja ja kuuntele kolinat.'], ['kaikki', 'Lämpöpumpun (2021→) ja Octovalve-ongelmat talvella. Varmista ohjelmistoversio.']],
    'TESLA|MODEL X': [['2016–2020', 'Falcon-ovien anturit ja sarana – kallis. Testaa kaikki ovet kylmässä.'], ['kaikki', 'Sama MCU1/kahva/ilmajousitus-lista kuin Model S.']],
    'TESLA|MODEL Y': [['2020→', 'Korin laatu (panel gap, maali), takaluukun vuoto. Katso Traficomin vikatilasto 3-vuotiaille.']],
    'FIAT|500E': [
      ['2013–2019 (USA)', 'USA-markkinan auto, Toluca Meksiko. Suomessa yksittäishyväksyntä → varmista autoveropäätös ja että katsastus on hyväksynyt (ajovalot, mittaristo km/h).'],
      ['2013–2019', '24 kWh akku, ~135 km todellinen; talvella 80–100 km. Pyydä akun SOH-lukema OBD:llä (esim. Car Scanner + 500e-profiili). Bosch-akkukennojen vaihto kallista.'],
      ['2013–2019', 'Latauslaite (OBC) ja "Service Electric" -virheet. Tarkista NHTSA-valitukset – OBC-viat ovat yleisin aihe.'],
      ['2013–2019', 'Pikalataus: vain 6,6 kW AC (Type 1 → Suomessa adapteri Type 2). Ei CCS:ää.'],
      ['2020→ (ZFA)', 'Uusi 500e (42 kWh) on eri auto – EU-tyyppihyväksytty, CCS 85 kW.'],
    ],
  };

  /* ---------- Tila ---------- */
  const state = { q: '', type: null, vin: null, plate: null, local: null, nhtsa: null, recalls: null, complaints: null, ratings: null, reg: null, peer: null, manual: {}, proxy: null, log: [] };
  const LS_KEY = 'autorontgen.manual';

  async function hasProxy() {
    if (state.proxy != null) return state.proxy;
    if (location.protocol === 'file:') return (state.proxy = false);
    try { const r = await fetch('/api/health', { cache: 'no-store' }); state.proxy = r.ok; } catch { state.proxy = false; }
    return state.proxy;
  }
  async function getJSON(direct, proxyPath) {
    const useProxy = await hasProxy();
    const url = useProxy && proxyPath ? proxyPath : direct;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.json();
  }

  /* ---------- Kontekstin kokoaminen (VIN-dekoodaus + NHTSA + käsin syötetty) ---------- */
  function ctx() {
    const n = state.nhtsa || {};
    const m = state.manual || {};
    const reg = state.reg || {};
    const make = m.make || reg.make || n.Make || (state.local && state.local.manufacturer) || '';
    let model = m.model || reg.model || n.Model || '';
    if (!model && state.local && state.local.brand === 'tesla') model = (state.local.brandFields.find(f => f[0] === 'Malli') || [])[1] || '';
    if (!model && state.local && state.local.brand === 'fiat' && state.vin && state.vin.startsWith('3C3CFFGE')) model = '500e';
    const year = m.year || reg.year || n.ModelYear || (state.local && state.local.modelYears && state.local.modelYears.filter(y => y >= 2000)[0]) || '';
    return { vin: state.vin, plate: state.plate, make: String(make).trim(), model: String(model).trim(), year: String(year).trim(),
      mass: Number(m.mass || reg.mass || n.GVWR_kg || 0) || null, curb: Number(m.curb || reg.curb || 0) || null,
      co2: m.co2 !== undefined && m.co2 !== '' ? Number(m.co2) : (reg.co2 != null ? Number(reg.co2) : null), km: Number(m.km || reg.km || 0) || null,
      fuel: m.fuel || reg.fuel || guessFuel(n, state.local) };
  }
  function guessFuel(n, local) {
    const ft = (n.FuelTypePrimary || '').toLowerCase();
    if (ft.includes('electric')) return 'sahko';
    if (ft.includes('diesel')) return 'diesel';
    if (ft.includes('gasoline')) return 'bensiini';
    if (local && (local.brand === 'tesla' || (state.vin || '').startsWith('3C3CFFGE'))) return 'sahko';
    return '';
  }
  const normKey = (c) => (c.make + '|' + c.model).toUpperCase().replace(/\s+/g, ' ').trim();

  /* ---------- Haku ---------- */
  async function run(q) {
    q = (q || '').trim(); if (!q) return;
    state.q = q; state.type = VINLIB.detectType(q);
    state.vin = state.plate = state.local = state.nhtsa = state.recalls = state.complaints = state.ratings = state.reg = state.peer = null; state.log = [];
    history.replaceState(null, '', '?q=' + encodeURIComponent(q));
    $('#results').hidden = false;
    if (state.type === 'vin' || state.type === 'vin-partial') {
      state.vin = VINLIB.clean(q); state.local = VINLIB.decodeVin(state.vin);
    } else if (state.type === 'plate') {
      state.plateInfo = VINLIB.parsePlate(q); state.plate = state.plateInfo.plate;
    } else {
      state.plateInfo = { ok: false, errors: ['Syöte ei ole VIN (17 merkkiä) eikä rekisteritunnus (ABC-123).'] };
    }
    renderAll();
    const jobs = [];
    if (state.vin) jobs.push(fetchNhtsaDecode().then(() => { renderAll(); return fetchNhtsaExtras(); }));
    if (state.plate) jobs.push(fetchReg().then(() => { renderAll(); return fetchNhtsaExtras(); }));
    if (!state.vin && !state.plate) jobs.push(fetchNhtsaExtras());
    await Promise.allSettled(jobs);
    renderAll();
  }

  async function fetchNhtsaDecode() {
    try {
      const d = await getJSON('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/' + state.vin + '?format=json', '/api/vin/' + state.vin);
      state.nhtsa = (d.Results && d.Results[0]) || null;
      if (state.nhtsa && state.nhtsa.ErrorCode && state.nhtsa.ErrorCode !== '0') state.log.push('NHTSA: ' + state.nhtsa.ErrorText);
    } catch (e) { state.nhtsaErr = String(e.message || e); }
  }
  async function fetchNhtsaExtras() {
    const c = ctx(); if (!c.make || !c.model || !c.year) return;
    const q = 'make=' + enc(c.make) + '&model=' + enc(c.model) + '&modelYear=' + enc(c.year);
    await Promise.allSettled([
      getJSON('https://api.nhtsa.gov/recalls/recallsByVehicle?' + q, '/api/recalls?' + q).then(d => state.recalls = d.results || []).catch(e => state.recallsErr = String(e.message || e)),
      getJSON('https://api.nhtsa.gov/complaints/complaintsByVehicle?' + q, '/api/complaints?' + q).then(d => state.complaints = d.results || []).catch(e => state.complaintsErr = String(e.message || e)),
      (async () => {
        const base = 'https://api.nhtsa.gov/SafetyRatings/modelyear/' + enc(c.year) + '/make/' + enc(c.make) + '/model/' + enc(c.model);
        const l = await getJSON(base, '/api/ratings?' + q);
        const id = l.Results && l.Results[0] && l.Results[0].VehicleId; if (!id) return;
        const r = await getJSON('https://api.nhtsa.gov/SafetyRatings/VehicleId/' + id, '/api/ratings/' + id);
        state.ratings = r.Results && r.Results[0];
      })().catch(e => state.ratingsErr = String(e.message || e)),
      fetchPeer(c),
    ]);
  }
  async function fetchReg() {
    if (!(await hasProxy())) { state.regErr = 'Rekisteritunnushaku tarvitsee server.js:n (ei CORS-vapaata suomalaista rajapintaa).'; return; }
    try { const d = await getJSON(null, '/api/reg/' + enc(state.plate)); if (d && d.ok) state.reg = d.vehicle; else state.regErr = (d && d.error) || 'ei tulosta'; }
    catch (e) { state.regErr = String(e.message || e); }
  }
  async function fetchPeer(c) {
    try {
      if (!window.__peerStats) {
        const r = await fetch('data/peer_stats.json', { cache: 'no-store' }); if (!r.ok) throw new Error('ei tiedostoa');
        window.__peerStats = await r.json();
      }
      const key = normKey(c) + '|' + c.year;
      state.peer = window.__peerStats[key] || null; state.peerKey = key;
      if (!state.peer) { // kokeile ilman mallinimen loppuosaa (esim. "MODEL S 75D" → "MODEL S")
        const alt = Object.keys(window.__peerStats).find(k => k.startsWith(c.make.toUpperCase() + '|') && k.endsWith('|' + c.year) && normKey(c).includes(k.split('|')[1]));
        if (alt) { state.peer = window.__peerStats[alt]; state.peerKey = alt; }
      }
    } catch (e) { state.peerErr = 'Vertaisryhmätilasto puuttuu (aja tools/build_peer_stats.py).'; }
  }

  /* ---------- Riskipisteet ---------- */
  function riskFlags() {
    const f = []; const c = ctx(); const L = state.local;
    if (L) {
      L.errors.forEach(e => f.push(['bad', e]));
      L.warnings.forEach(w => f.push(['warn', w]));
      if (L.checkDigit && L.checkDigit.valid) f.push(['ok', 'VIN:n tarkistusnumero täsmää.']);
      if (!['Suomi', 'Saksa', 'Ruotsi', 'Belgia', 'Alankomaat', 'Ranska', 'Espanja', 'Italia', 'Tšekki', 'Slovakia', 'Unkari', 'Puola', 'Itävalta', 'Portugali', 'Romania', 'Iso-Britannia', 'Japani', 'Etelä-Korea', 'Turkki'].includes(L.region))
        f.push([L.brand === 'tesla' ? 'info' : 'warn', 'Valmistettu alueella "' + L.region + '"' + (L.brand === 'tesla' ? ' – Teslalla normaalia (EU-autotkin Fremontista/Shanghaista). Varmista silti onko yksilö alun perin EU-myyty vai USA/Norja-tuonti.' : ' – todennäköinen tuontiauto.') + ' Varmista autoveropäätös (vero.fi) ja rekisteröintihistoria; USA-autoissa myös CARFAX-raportti kannattaa (vakuutuslunastus / salvage title).']);
    }
    if (state.nhtsa && state.nhtsa.ErrorCode && !/^0/.test(state.nhtsa.ErrorCode)) f.push(['warn', 'NHTSA ei pystynyt dekoodaamaan VIN:iä kokonaan: ' + state.nhtsa.ErrorText]);
    if (state.nhtsa && state.manual.year && state.nhtsa.ModelYear && String(state.manual.year) !== String(state.nhtsa.ModelYear)) f.push(['bad', 'Ilmoitettu vuosimalli ' + state.manual.year + ' ≠ VIN:n mallivuosi ' + state.nhtsa.ModelYear + '.']);
    if (state.recalls) {
      if (state.recalls.length === 0) f.push(['ok', 'Ei NHTSA-takaisinkutsuja tälle malli/vuosi-yhdistelmälle.']);
      else f.push([state.recalls.length > 5 ? 'warn' : 'info', state.recalls.length + ' NHTSA-takaisinkutsua (malli/vuosi-taso, ei yksilö). Tarkista että kampanjat on tehty – Tesla: VIN-haku, Fiat: Mopar.']);
    }
    if (state.complaints && state.complaints.length > 150) f.push(['warn', state.complaints.length + ' NHTSA-omistajavalitusta – mallilla on kroonisia vikoja. Katso komponenttijakauma alla.']);
    if (state.peer && c.km) {
      const ratio = c.km / state.peer.km_median;
      if (ratio > 1.6) f.push(['warn', 'Mittarilukema ' + fmt(c.km) + ' km on ' + Math.round((ratio - 1) * 100) + ' % yli saman mallin/vuoden mediaanin Suomessa (' + fmt(state.peer.km_median) + ' km). Kova käyttö tai taksi/leasing?']);
      else if (ratio < 0.45 && Number(c.year) < new Date().getFullYear() - 3) f.push(['warn', 'Mittarilukema on vain ' + Math.round(ratio * 100) + ' % mediaanista. Epäilyttävän vähän – pyydä katsastushistorian lukemat Traficomista (mittarimanipulaatio on yleistä tuontiautoissa).']);
      else f.push(['ok', 'Mittarilukema on normaalilla alueella vertaisryhmään nähden.']);
    }
    if (c.year && Number(c.year) <= 2018 && /TESLA/i.test(c.make) && /MODEL (S|X)/i.test(c.model)) f.push(['info', 'Model S/X ≤2018: varmista MCU1→MCU2-päivitys tai eMMC-korjaus (takaisinkutsu 21V-035) ja ilmaisen Superchargerin siirtyvyys.']);
    if (state.plate && !state.reg) f.push(['info', 'Rekisteritunnuksella ainoa kattava ja laillinen lähde on Traficomin Oma asiointi (ilmainen, tunnistautuminen). Avaa se Linkit-kortista.']);
    return f;
  }
  function riskScore(flags) {
    let s = 0; for (const [lvl] of flags) s += lvl === 'bad' ? 35 : lvl === 'warn' ? 12 : 0;
    return Math.min(100, s);
  }

  /* ---------- Render ---------- */
  function renderAll() {
    const c = ctx();
    $('#title').textContent = [c.make, c.model, c.year].filter(Boolean).join(' ') || (state.vin ? 'VIN ' + state.vin : state.plate || '');
    $('#sub').textContent = state.vin ? 'VIN ' + state.vin : state.plate ? 'Rekisteritunnus ' + state.plate : '';
    renderRisk(); renderLocal(); renderNhtsa(); renderRecalls(); renderComplaints(); renderRatings(); renderPeer(); renderTax(); renderIssues(); renderLinks(); renderManual(); renderReg();
  }
  function card(id) { const el = $('#' + id); el.innerHTML = ''; return el; }
  function status(el, text, cls) { el.append(h('span', { class: 'st ' + (cls || '') }, text)); }

  function renderRisk() {
    const el = card('risk'); const flags = riskFlags(); const score = riskScore(flags);
    const g = score >= 50 ? 'var(--bad)' : score >= 20 ? 'var(--warn)' : 'var(--ok)';
    el.append(h('h2', {}, 'Punaiset liput', h('span', { class: 'st' }, flags.length + ' havaintoa')));
    const gauge = h('div', { class: 'gauge', style: '--p:' + score + ';--g:' + g }, h('div', {}, score));
    el.append(h('div', { class: 'score' }, gauge, h('div', {}, h('div', { style: 'font-weight:700;font-size:18px' }, score >= 50 ? 'Pysähdy ja selvitä' : score >= 20 ? 'Tarkista ennen kauppaa' : 'Ei hälyttävää'), h('div', { class: 'empty' }, 'Pisteet: virhe = 35, varoitus = 12. Tämä ei korvaa Traficomin tietoja eikä koeajoa.'))));
    const box = h('div', { style: 'margin-top:10px' });
    flags.forEach(([lvl, txt]) => box.append(h('div', { class: 'flag ' + lvl }, h('span', { class: 'ic' }, { bad: '⛔', warn: '⚠️', ok: '✅', info: 'ℹ️' }[lvl]), h('span', {}, txt))));
    if (!flags.length) box.append(h('div', { class: 'empty' }, 'Syötä VIN tai rekisteritunnus.'));
    el.append(box);
  }
  function kvList(pairs) { const dl = h('dl', { class: 'kv' }); pairs.forEach(([k, v]) => dl.append(h('dt', {}, k), h('dd', { html: '<b>' + esc(v) + '</b>' }))); return dl; }

  function renderLocal() {
    const el = card('local'); const L = state.local;
    el.append(h('h2', {}, 'VIN-tulkinta (paikallinen)', h('span', { class: 'st ok' }, 'ei verkkoa')));
    if (!L) { if (state.plateInfo) { el.append(kvList([['Tunnus', state.plateInfo.plate]]), ...(state.plateInfo.notes || state.plateInfo.errors || []).map(n => h('div', { class: 'flag info' }, n))); } else el.append(h('div', { class: 'empty' }, '–')); return; }
    el.append(kvList(L.fields));
    if (L.brandFields.length) { el.append(h('h2', { style: 'margin-top:14px' }, L.brand === 'tesla' ? 'Tesla-dekooderi (Part 565)' : 'Fiat-dekooderi')); el.append(kvList(L.brandFields)); }
  }
  function renderNhtsa() {
    const el = card('nhtsa'); const n = state.nhtsa;
    el.append(h('h2', {}, 'NHTSA vPIC-dekooderi', h('span', { class: 'st live' }, 'live')));
    if (!state.vin) return el.append(h('div', { class: 'empty' }, 'Vaatii VIN:n.'));
    if (!n) return el.append(state.nhtsaErr ? h('div', { class: 'flag warn' }, 'Haku epäonnistui: ' + state.nhtsaErr + (location.protocol === 'file:' ? ' – avaa sivu server.js:n kautta (http://localhost:8787), file:// estää osan hauista.' : '')) : h('div', {}, h('span', { class: 'spin' }), ' haetaan…'));
    const want = [['Make', 'Merkki'], ['Model', 'Malli'], ['ModelYear', 'Mallivuosi'], ['Series', 'Sarja'], ['Trim', 'Varustetaso'], ['BodyClass', 'Kori'], ['Doors', 'Ovet'], ['DriveType', 'Vetotapa'], ['ElectrificationLevel', 'Sähköistys'], ['FuelTypePrimary', 'Käyttövoima'], ['EngineHP', 'Teho (hv)'], ['EngineKW', 'Teho (kW)'], ['DisplacementL', 'Iskutilavuus (l)'], ['BatteryKWh', 'Akku (kWh)'], ['BatteryType', 'Akkutyyppi'], ['EVDriveUnit', 'Moottorit'], ['ChargerLevel', 'Laturi'], ['PlantCountry', 'Valmistusmaa'], ['PlantCity', 'Tehdas'], ['Manufacturer', 'Valmistaja (oik.)'], ['GVWR', 'Kokonaismassaluokka'], ['Seats', 'Istuimet'], ['SteeringLocation', 'Ohjaus'], ['VehicleType', 'Ajoneuvotyyppi'], ['ABS', 'ABS'], ['ESC', 'ESC'], ['AdaptiveCruiseControl', 'Mukautuva vakionopeus'], ['ForwardCollisionWarning', 'Törmäysvaroitin'], ['LaneDepartureWarning', 'Kaistavahti'], ['NCSABodyType', 'NCSA-kori']];
    const pairs = want.filter(([k]) => n[k] && String(n[k]).trim()).map(([k, l]) => [l, n[k]]);
    if (n.ErrorCode && n.ErrorCode !== '0') el.append(h('div', { class: 'flag warn' }, 'NHTSA: ' + n.ErrorText));
    el.append(pairs.length ? kvList(pairs) : h('div', { class: 'empty' }, 'NHTSA ei tunnista tätä VIN:iä (EU-auto?). Täydennä merkki/malli/vuosi käsin alla, niin takaisinkutsut ja tilastot haetaan silti.'));
    const extra = Object.entries(n).filter(([k, v]) => v && String(v).trim() && !want.some(w => w[0] === k) && !['ErrorCode', 'ErrorText', 'VIN', 'AdditionalErrorText', 'SuggestedVIN', 'PossibleValues'].includes(k));
    if (extra.length) { const d = h('details', {}, h('summary', {}, 'Kaikki ' + extra.length + ' lisäkenttää')); d.append(kvList(extra)); el.append(d); }
  }
  function renderRecalls() {
    const el = card('recalls'); const r = state.recalls;
    el.append(h('h2', {}, 'Takaisinkutsut (NHTSA, USA)', h('span', { class: 'st ' + (r ? (r.length ? 'warn' : 'ok') : 'live') }, r ? r.length + ' kpl' : 'live')));
    if (!r) return el.append(h('div', { class: 'empty' }, state.recallsErr ? 'Haku epäonnistui: ' + state.recallsErr : ctx().make ? h('span', {}, h('span', { class: 'spin' }), ' haetaan…') : 'Vaatii merkki + malli + vuosi (VIN tai käsin).'));
    if (!r.length) return el.append(h('div', { class: 'empty' }, 'Ei kampanjoita. Huom: EU-takaisinkutsut eivät näy täällä – katso Traficom/Safety Gate -linkit.'));
    const ul = h('ul', { class: 'list' });
    r.slice(0, 40).forEach(x => ul.append(h('li', {}, h('b', {}, x.Component || '?'), ' – ', (x.Summary || '').slice(0, 220) + ((x.Summary || '').length > 220 ? '…' : ''), h('small', {}, [x.NHTSACampaignNumber, x.ReportReceivedDate, x.parkIt ? '⚠ ÄLÄ AJA' : '', x.overTheAirUpdate ? 'OTA-päivitys' : ''].filter(Boolean).join(' · ')))));
    el.append(ul);
  }
  function renderComplaints() {
    const el = card('complaints'); const c = state.complaints;
    el.append(h('h2', {}, 'Omistajavalitukset (NHTSA)', h('span', { class: 'st ' + (c ? '' : 'live') }, c ? c.length + ' kpl' : 'live')));
    if (!c) return el.append(h('div', { class: 'empty' }, state.complaintsErr ? 'Haku epäonnistui: ' + state.complaintsErr : ctx().make ? '…' : 'Vaatii merkki + malli + vuosi.'));
    if (!c.length) return el.append(h('div', { class: 'empty' }, 'Ei valituksia rekisterissä.'));
    const by = {}; c.forEach(x => (x.components || 'MUU').split(',').forEach(k => { k = k.trim(); by[k] = (by[k] || 0) + 1; }));
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8); const max = top[0][1];
    top.forEach(([k, v]) => el.append(h('div', { style: 'font-size:13px;margin:6px 0' }, h('div', { style: 'display:flex;justify-content:space-between' }, h('span', {}, k), h('span', { class: 'num' }, v)), h('div', { class: 'bar' }, h('div', { class: 'rng', style: 'left:0;width:' + (v / max * 100) + '%' })))));
    const fires = c.filter(x => x.fire).length, crashes = c.filter(x => x.crash).length, inj = c.reduce((s, x) => s + (x.numberOfInjuries || 0), 0);
    el.append(h('div', { class: 'empty' }, 'Tulipalo ' + fires + ' · kolari ' + crashes + ' · loukkaantumisia ' + inj));
  }
  function renderRatings() {
    const el = card('ratings'); const r = state.ratings;
    el.append(h('h2', {}, 'Törmäysturvallisuus (NHTSA)', h('span', { class: 'st live' }, 'live')));
    if (!r) return el.append(h('div', { class: 'empty' }, state.ratingsErr ? 'Ei luokitusta / haku epäonnistui.' : ctx().make ? 'Ei luokitusta tälle mallille tai haku kesken.' : 'Vaatii merkki + malli + vuosi.'));
    const stars = (v) => /^\d/.test(v) ? '★'.repeat(Number(v)) + '☆'.repeat(5 - Number(v)) : (v || '–');
    el.append(kvList([['Kokonais', stars(r.OverallRating)], ['Etutörmäys', stars(r.OverallFrontCrashRating)], ['Sivutörmäys', stars(r.OverallSideCrashRating)], ['Kaatuminen', stars(r.RolloverRating)], ['Ajoneuvo', r.VehicleDescription]]));
  }
  function renderPeer() {
    const el = card('peer'); const p = state.peer; const c = ctx();
    el.append(h('h2', {}, 'Vertaisryhmä Suomessa (Traficom avoin data)', h('span', { class: 'st ' + (p ? 'ok' : '') }, p ? p.n + ' autoa' : 'tilasto')));
    if (!p) return el.append(h('div', { class: 'empty' }, state.peerErr || (c.make ? 'Ei osumaa avaimella ' + (state.peerKey || '') + '. Tarkista data/peer_stats.json tai mallinimi.' : 'Vaatii merkki + malli + vuosi.')));
    const max = Math.max(p.km_p90 || p.km_p75 * 1.3, c.km || 0) * 1.05;
    const pct = (v) => (v / max * 100).toFixed(1) + '%';
    el.append(h('div', { class: 'empty' }, 'Viimeisin katsastuksen mittarilukema samalla merkki/malli/vuosi-yhdistelmällä liikennekäytössä (' + (p.as_of || 'aineiston pvm') + ').'));
    const bar = h('div', { class: 'bar' }, h('div', { class: 'rng', style: 'left:' + pct(p.km_p25) + ';width:' + pct(p.km_p75 - p.km_p25) }), h('div', { class: 'med', style: 'left:' + pct(p.km_median) }));
    if (c.km) bar.append(h('div', { class: 'you', style: 'left:' + pct(c.km), title: 'tämä auto' }));
    el.append(bar, h('div', { class: 'axis' }, h('span', {}, '0'), h('span', {}, fmt(Math.round(max / 1000)) + ' tkm')));
    el.append(kvList([['Mediaani', fmt(p.km_median) + ' km'], ['Kvartiilit 25–75 %', fmt(p.km_p25) + ' – ' + fmt(p.km_p75) + ' km'], ['Keskiarvo', fmt(p.km_mean) + ' km'], ['Tämä auto', c.km ? fmt(c.km) + ' km' : 'syötä mittarilukema alla'], ['Omamassa (mediaani)', p.mass_median ? fmt(p.mass_median) + ' kg' : '–'], ['CO2 (mediaani)', p.co2_median != null ? p.co2_median + ' g/km' : '–'], ['Yleisin väri', p.top_color || '–'], ['Yleisin kunta', p.top_kunta || '–']]));
  }
  function renderTax() {
    const el = card('tax'); const c = ctx();
    el.append(h('h2', {}, 'Ajoneuvovero 2026 (arvio)', h('span', { class: 'st ok' }, 'laskuri')));
    const mass = c.mass || (c.curb ? c.curb : null);
    const fuel = c.fuel || 'sahko';
    const days = 365;
    const kv100 = mass ? Math.ceil(mass / 100) : null;
    const rate = TAX_2026.kayttovoima_c_per_day_100kg[fuel];
    const kvv = kv100 != null && rate != null ? kv100 * rate * days / 100 : null;
    const perus = (fuel === 'sahko' || c.co2 === 0) ? TAX_2026.perusvero_min_eur_year : null;
    const rows = h('div', { class: 'taxout' });
    rows.append(h('span', {}, 'Perusvero (' + (fuel === 'sahko' ? '0 g/km WLTP' : c.co2 != null ? c.co2 + ' g/km' : 'CO2 puuttuu') + ')'), h('span', { class: 'num' }, perus != null ? eur(perus) : 'katso Traficomin taulukko'));
    rows.append(h('span', {}, 'Käyttövoimavero (' + { sahko: 'sähkö 1,9 c', diesel: 'diesel 5,5 c', kaasu: 'kaasu 3,1 c', bensiini: 'bensiini 0 c' }[fuel] + '/pv per alkava 100 kg' + (mass ? ', ' + fmt(mass) + ' kg → ' + kv100 + ' × 100 kg' : '') + ')'), h('span', { class: 'num' }, kvv != null ? eur(kvv) : 'massa puuttuu'));
    if (perus != null && kvv != null) rows.append(h('span', { class: 'total' }, 'Yhteensä / vuosi'), h('span', { class: 'num total' }, eur(perus + kvv)));
    el.append(rows, h('div', { class: 'empty' }, 'Käytetty massa: ' + (c.mass ? 'kokonaismassa' : c.curb ? 'omamassa (sähköautolla vero lasketaan kokonaismassasta → syötä se)' : 'ei tiedossa') + '. Perusvero muille kuin 0 g/km -autoille vain Traficomin taulukosta (linkit). 1.1.2026 korotus: sähkö 1,5→1,9 c, perusvero min 53→106 €/v.'));
  }
  function renderIssues() {
    const el = card('issues'); const c = ctx();
    const key = Object.keys(KNOWN_ISSUES).find(k => normKey(c).startsWith(k) || (k.split('|')[1] && normKey(c).includes(k.split('|')[1]) && normKey(c).startsWith(k.split('|')[0])));
    el.append(h('h2', {}, 'Tunnetut mallikohtaiset ongelmat', h('span', { class: 'st' }, 'muistilista')));
    if (!key) return el.append(h('div', { class: 'empty' }, c.make ? 'Ei paikallista muistilistaa mallille ' + normKey(c) + '. Katso omistajavalitusten komponenttijakauma ja Traficomin vikatilasto.' : 'Tunnista auto ensin.'));
    const ul = h('ul', { class: 'list' }); KNOWN_ISSUES[key].forEach(([y, t]) => ul.append(h('li', {}, h('small', {}, y), t))); el.append(ul);
  }
  function renderLinks() {
    const el = card('links'); const c = ctx();
    el.append(h('h2', {}, 'Jatka tästä – syvälinkit lähteisiin'));
    const groups = {};
    SOURCES.forEach(s => { if (s.only && s.only !== (state.local && state.local.brand) && !normKey(c).startsWith(s.only.toUpperCase())) return; (groups[s.group] = groups[s.group] || []).push(s); });
    for (const [g, list] of Object.entries(groups)) {
      el.append(h('div', { style: 'color:var(--muted);font-size:12px;margin:10px 0 2px;text-transform:uppercase;letter-spacing:.06em' }, g));
      const box = h('div', { class: 'links' });
      list.forEach(s => { let u; try { u = s.url(c); } catch { u = '#'; } box.append(h('a', { href: u, target: '_blank', rel: 'noopener', title: s.gives }, s.name, h('span', { class: 'st ' + accessCls(s.access[0]) }, accessLabel(s.access[0])))); });
      el.append(box);
    }
  }
  const accessLabel = (a) => ({ live: 'API', proxy: 'proxy', link: 'linkki', login: 'kirjautuminen', paid: '€', file: 'aineisto' }[a] || a);
  const accessCls = (a) => ({ live: 'live', proxy: 'warn', paid: 'bad', login: 'warn', link: '', file: 'ok' }[a] || '');

  function renderReg() {
    const el = card('reg');
    el.append(h('h2', {}, 'Rekisteritunnushaku (Suomi)', h('span', { class: 'st ' + (state.reg ? 'ok' : 'warn') }, state.reg ? state.reg.source || 'proxy' : 'proxy')));
    if (!state.plate) return el.append(h('div', { class: 'empty' }, 'Vaatii rekisteritunnuksen. Suomessa ei ole avointa rajapintaa rekkari→auto; server.js kokeilee kaupallista varaosahakua ja muuten ohjaa Traficomiin.'));
    if (state.reg) return el.append(kvList(Object.entries(state.reg).filter(([k, v]) => v != null && v !== '' && k !== 'raw').map(([k, v]) => [k, v])));
    el.append(h('div', { class: 'flag warn' }, state.regErr || 'haetaan…'), h('div', { class: 'empty' }, 'Täydennä tiedot käsin alla (merkki, malli, vuosi) – loput kortit toimivat silloin täysin. Traficomin Oma asiointi näyttää ilmaiseksi tekniset tiedot ja veron.'));
  }
  function renderManual() {
    const el = card('manual'); const m = state.manual; const c = ctx();
    el.append(h('h2', {}, 'Täydennä käsin', h('span', { class: 'st' }, 'tallentuu selaimeen')));
    const f = h('form', { class: 'manual', onsubmit: (e) => { e.preventDefault(); const fd = new FormData(e.target); state.manual = Object.fromEntries([...fd.entries()].filter(([, v]) => v !== '')); try { localStorage.setItem(LS_KEY, JSON.stringify(state.manual)); } catch { } renderAll(); fetchNhtsaExtras().then(renderAll); } });
    const inp = (name, label, val, type = 'text', ph = '') => h('label', {}, label, h('input', { name, value: val == null ? '' : val, type, placeholder: ph, ...(type === 'number' ? { min: 0, step: 1 } : {}) }));
    f.append(inp('make', 'Merkki', m.make || c.make, 'text', 'Tesla'), inp('model', 'Malli (NHTSA-muoto)', m.model || c.model, 'text', 'Model S'), inp('year', 'Vuosimalli', m.year || c.year, 'number', '2018'),
      inp('km', 'Mittarilukema km', m.km, 'number', '120000'), inp('mass', 'Kokonaismassa kg', m.mass, 'number', '2600'), inp('curb', 'Omamassa kg', m.curb, 'number', '2100'), inp('co2', 'CO2 g/km (WLTP)', m.co2, 'number', '0'));
    const sel = h('select', { name: 'fuel' }); [['', 'auto'], ['sahko', 'sähkö'], ['bensiini', 'bensiini'], ['diesel', 'diesel'], ['kaasu', 'kaasu']].forEach(([v, l]) => sel.append(h('option', { value: v, ...(m.fuel === v ? { selected: '' } : {}) }, l)));
    f.append(h('label', {}, 'Käyttövoima', sel), h('label', {}, ' ', h('button', { class: 'btn secondary', type: 'submit' }, 'Päivitä')));
    el.append(f);
  }

  /* ---------- Lähdekartta ---------- */
  function renderSources() {
    const t = h('table', { class: 'src' }, h('thead', {}, h('tr', {}, h('th', {}, 'Lähde'), h('th', {}, 'Pääsy'), h('th', {}, 'Hakuavain'), h('th', {}, 'Mitä saat'), h('th', {}, 'Tila'))));
    const tb = h('tbody'); let g = null;
    SOURCES.forEach(s => {
      if (s.group !== g) { g = s.group; tb.append(h('tr', { class: 'group' }, h('td', { colspan: 5 }, g))); }
      tb.append(h('tr', {}, h('td', {}, h('a', { href: safeUrl(s), target: '_blank', rel: 'noopener' }, s.name), s.note ? h('div', { style: 'color:var(--muted);font-size:12px' }, s.note) : null),
        h('td', {}, ...s.access.map(a => h('span', { class: 'st ' + accessCls(a) }, accessLabel(a)))), h('td', {}, s.by.join(', ')), h('td', {}, s.gives),
        h('td', {}, h('span', { class: 'st ' + (s.verified ? 'ok' : 'warn') }, s.verified ? 'varmistettu' : 'ei testattu'))));
    });
    t.append(tb); $('#sources').append(t);
  }
  function safeUrl(s) { try { return s.url(ctx()); } catch { return '#'; } }

  /* ---------- Export ---------- */
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ query: state.q, context: ctx(), local: state.local, nhtsa: state.nhtsa, recalls: state.recalls, complaints: state.complaints && state.complaints.length, ratings: state.ratings, reg: state.reg, peer: state.peer, flags: riskFlags(), generated: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'autorontgen-' + (state.vin || state.plate || 'raportti') + '.json' }); document.body.append(a); a.click(); a.remove();
  }

  /* ---------- Init ---------- */
  function init() {
    try { state.manual = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { state.manual = {}; }
    $('#form').addEventListener('submit', (e) => { e.preventDefault(); run($('#q').value); });
    $('#clear').addEventListener('click', () => { state.manual = {}; try { localStorage.removeItem(LS_KEY); } catch { } $('#q').value = ''; $('#results').hidden = true; history.replaceState(null, '', location.pathname); });
    $('#print').addEventListener('click', () => window.print());
    $('#json').addEventListener('click', exportJSON);
    $('#share').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(location.href); });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t)); document.querySelectorAll('[data-view]').forEach(v => v.hidden = v.dataset.view !== t.dataset.tab); }));
    document.querySelectorAll('[data-example]').forEach(b => b.addEventListener('click', () => { $('#q').value = b.dataset.example; run(b.dataset.example); }));
    renderSources();
    hasProxy().then(p => { $('#proxy').textContent = p ? 'server.js: yhdistetty (proxy + välimuisti)' : 'server.js: ei käytössä – suorat haut (NHTSA) toimivat, rekkarihaku ei'; $('#proxy').className = 'st ' + (p ? 'ok' : 'warn'); });
    const q = new URLSearchParams(location.search).get('q'); if (q) { $('#q').value = q; run(q); }
  }
  window.AUTORONTGEN = { run, state, ctx, riskFlags };
  document.addEventListener('DOMContentLoaded', init);
})();
