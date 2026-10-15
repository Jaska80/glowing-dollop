/* Autoröntgen – sovelluslogiikka. Toimii myös suoraan file:// -tiedostona; server.js laajentaa (proxy, välimuisti, luotaimet). */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => n == null || isNaN(n) ? '–' : Number(n).toLocaleString('fi-FI');
  const eur = (n) => Number(n).toLocaleString('fi-FI', { style: 'currency', currency: 'EUR' });
  const up = (s) => String(s || '').toUpperCase().trim();
  const enc = encodeURIComponent;

  const TAX_2026 = { perusvero_min_eur_year: 106.21, kayttovoima_c_per_day_100kg: { sahko: 1.9, diesel: 5.5, kaasu: 3.1, bensiini: 0, hybridi: 0, phev: 1.95 } };
  const EU_ETA = ['Suomi', 'Saksa', 'Ruotsi', 'Belgia', 'Alankomaat', 'Ranska', 'Espanja', 'Italia', 'Tšekki', 'Slovakia', 'Unkari', 'Puola', 'Itävalta', 'Portugali', 'Romania', 'Iso-Britannia', 'Turkki', 'Serbia/Kroatia', 'Saksa (ent. DDR)', 'Tanska', 'Sveitsi'];
  const FEATURES = [['panorama', 'Panoraama-/kattoluukku'], ['ilmajousitus', 'Ilmajousitus'], ['matrix', 'Matrix/adaptiiviset LED tai xenon'], ['webasto', 'Polttoainelämmitin (Webasto)'], ['vetokoukku', 'Vetokoukku'], ['isot-vanteet', 'Vanteet ≥ 19"']];
  const COLORS = ['Musta', 'Valkoinen', 'Harmaa', 'Hopea', 'Sininen', 'Punainen', 'Ruskea (beige)', 'Vihreä', 'Keltainen', 'Oranssi', 'Violetti', 'Turkoosi', 'Monivärinen'];
  const COUNTRIES = [['', '–'], ['SE', 'Ruotsi'], ['NO', 'Norja'], ['DE', 'Saksa'], ['DK', 'Tanska'], ['UK', 'Iso-Britannia'], ['EE', 'Viro'], ['NL', 'Alankomaat'], ['BE', 'Belgia'], ['US', 'USA'], ['CA', 'Kanada'], ['JP', 'Japani'], ['XX', 'Muu']];

  /* ---------- Tila ---------- */
  const state = { q: '', type: null, vin: null, plate: null, local: null, nhtsa: null, recalls: null, complaints: null, ratings: null, reg: null, peer: null, probe: null, manual: {}, proxy: null };
  const LS_KEY = 'autorontgen.manual.v2';
  const DEMO = window.DEMO || null;
  const demoFor = () => DEMO && state.vin && DEMO.vins[state.vin] || null;

  async function hasProxy() {
    if (state.proxy != null) return state.proxy;
    if (location.protocol === 'file:' || DEMO) return (state.proxy = false);
    try { const r = await fetch('/api/health', { cache: 'no-store' }); state.proxy = r.ok; } catch { state.proxy = false; }
    return state.proxy;
  }
  async function getJSON(direct, proxyPath) {
    const useProxy = await hasProxy();
    const url = useProxy && proxyPath ? proxyPath : direct;
    if (!url) throw new Error('ei osoitetta');
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    if (r.status === 400 && /^\s*\{"count":0,/i.test(text)) return JSON.parse(text); // NHTSA complaints: tyhjä tulos tulee 400:lla
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return JSON.parse(text);
  }

  /* ---------- Profiili: VIN + NHTSA + rekkarihaku + käsin syötetty → yksi kuva autosta ---------- */
  function mapTrans(s) { s = String(s || ''); if (/manual|standard/i.test(s) && !/automated/i.test(s)) return 'manuaali'; if (/CVT|continuously/i.test(s)) return 'cvt'; if (/dual|automated manual|DCT|DSG/i.test(s)) return 'kaksoiskytkin'; if (/automatic/i.test(s)) return 'automaatti'; return ''; }
  function mapDrive(s) { s = String(s || ''); if (/AWD|4WD|4x4|all/i.test(s)) return 'neli'; if (/FWD|front/i.test(s)) return 'etu'; if (/RWD|rear/i.test(s)) return 'taka'; return ''; }
  function guessFuel(n, local) {
    const el = (n.ElectrificationLevel || '').toLowerCase(), ft = (n.FuelTypePrimary || '').toLowerCase();
    if (/bev|battery electric/.test(el) || (ft.includes('electric') && !ft.includes('hybrid'))) return 'sahko';
    if (/phev|plug-in/.test(el)) return 'phev';
    if (/hybrid/.test(el) && !/mild/.test(el)) return 'hybridi';
    if (ft.includes('diesel')) return 'diesel';
    if (ft.includes('gasoline') || ft.includes('petrol')) return 'bensiini';
    if (/natural gas|cng|lpg/.test(ft)) return 'kaasu';
    if (local && (local.brand === 'tesla' || (state.vin || '').startsWith('3C3CFFGE'))) return 'sahko';
    return '';
  }
  function ctx() {
    const n = state.nhtsa || {}, m = state.manual || {}, reg = state.reg || {}, L = state.local;
    const make = m.make || reg.make || n.Make || (L && L.manufacturer && L.manufacturer.split(' ')[0]) || '';
    let model = m.model || reg.model || n.Model || '';
    if (!model && L && L.brand === 'tesla') model = (L.brandFields.find(f => f[0] === 'Malli') || [])[1] || '';
    if (!model && state.vin && state.vin.startsWith('3C3CFFGE')) model = '500e';
    const year = Number(m.year || reg.year || n.ModelYear || (L && L.modelYears && L.modelYears.filter(y => y >= 2000)[0]) || 0) || null;
    const fuel = m.fuel || reg.fuel || guessFuel(n, L);
    const now = new Date().getFullYear();
    const km = Number(m.km || reg.km || 0) || null;
    const age = year ? Math.max(0.5, now - year + 0.5) : null;
    const origin = L ? L.region : (m.foreignCountry === 'US' ? 'USA' : '');
    const feat = new Set((m.feat || '').split(',').filter(Boolean));
    const c = {
      vin: state.vin, plate: state.plate, make: String(make).trim(), model: String(model).trim(), year, fuel,
      ev: fuel === 'sahko', hybrid: fuel === 'hybridi' || fuel === 'phev',
      engineCode: up(m.engine || reg.engine || '').replace(/[\s\-]/g, ''), engineText: up((m.engine || '') + ' ' + (n.EngineModel || '') + ' ' + (reg.engine || '')),
      disp: Number(m.disp || n.DisplacementL || 0) || null, cyl: Number(m.cyl || n.EngineCylinders || 0) || null,
      turbo: m.turbo ? m.turbo === 'kyllä' : (n.Turbo === 'Yes' ? true : null),
      trans: m.trans || mapTrans(n.TransmissionStyle), transText: ((m.trans || '') + ' ' + (n.TransmissionStyle || '') + ' ' + (m.transNote || '')).toLowerCase(),
      drive: m.drive || mapDrive(n.DriveType), kwh: Number(m.kwh || n.BatteryKWh || 0) || null,
      mass: Number(m.mass || reg.mass || 0) || null, curb: Number(m.curb || reg.curb || 0) || null, co2: m.co2 !== undefined && m.co2 !== '' ? Number(m.co2) : (reg.co2 != null ? Number(reg.co2) : null),
      km, age, kmPerYear: km && age ? Math.round(km / age) : null, origin, feat,
      teslaBattery: L && L.brand === 'tesla' ? state.vin[6] : null, teslaMotor: L && L.brand === 'tesla' ? state.vin[7] : null,
      foreignReg: (m.foreignReg || '').trim(), foreignCountry: m.foreignCountry || '', firstReg: m.firstReg || '', color: m.color || '', kunta: m.kunta || '',
    };
    // Tuontiauto-lippu: ilmoitettu tuontimaa, tai valmistettu EU/ETA:n, Japanin ja Korean ulkopuolella – paitsi Tesla, jonka EU-autotkin ovat USA/Kiina-valmisteisia (silloin vain käyttäjän ilmoittama tuontimaa ratkaisee)
    c.importFlag = !!(c.foreignCountry || (origin && !EU_ETA.includes(origin) && !['Japani', 'Etelä-Korea'].includes(origin) && !(L && L.brand === 'tesla')));
    if (c.fuel === 'sahko' && !c.trans) c.trans = 'ev';
    return c;
  }
  const normKey = (c) => (up(c.make) + '|' + up(c.model)).replace(/\s+/g, ' ');

  /* ---------- Sääntöjen täsmäytys ---------- */
  function matchRule(r, c) {
    const m = r.match, why = [];
    const inRange = (v, [a, b]) => v != null && v >= a && v <= b;
    if (m.engine) {
      if (!c.engineCode && !c.engineText.trim()) return null;
      const hit = m.engine.find(e => { const E = up(e).replace(/[\s\-]/g, ''); return (c.engineCode && c.engineCode.startsWith(E)) || (E.length >= 3 && c.engineText.replace(/[\s\-]/g, '').includes(E)); });
      if (!hit) return null; why.push('moottori ' + hit);
    }
    if (m.make) { if (!c.make || !m.make.some(x => up(c.make).startsWith(up(x)) || up(x).startsWith(up(c.make)))) return null; why.push('merkki ' + c.make); }
    if (m.model) { if (!c.model || !new RegExp(m.model, 'i').test(c.model)) return null; why.push('malli ' + c.model); }
    if (m.years) { if (!inRange(c.year, m.years)) return null; why.push('vuosi ' + c.year); }
    if (m.fuel) { const f = c.fuel === 'phev' ? 'hybridi' : c.fuel; if (!f || !m.fuel.includes(f) && !(m.fuel.includes('hybridi') && c.fuel === 'phev')) return null; why.push('käyttövoima ' + c.fuel); }
    if (m.disp) { if (!inRange(c.disp, m.disp)) return null; why.push(c.disp + ' l'); }
    if (m.cyl) { if (c.cyl !== m.cyl) return null; why.push(c.cyl + ' syl.'); }
    if (m.turbo != null) { if (c.turbo !== m.turbo) return null; why.push('turbo'); }
    if (m.trans) { if (!c.transText.trim() && !c.trans) return null; if (!new RegExp(m.trans, 'i').test(c.transText + ' ' + c.trans)) return null; why.push('vaihteisto ' + (c.trans || c.transText.trim())); }
    if (m.drive) { if (c.drive !== m.drive) return null; why.push('neliveto'); }
    if (m.ev) { if (!c.ev) return null; why.push('sähköauto'); }
    if (m.feat) { const f = m.feat.find(x => c.feat.has(x)); if (!f) return null; why.push('varuste: ' + (FEATURES.find(x => x[0] === f) || [f, f])[1]); }
    if (m.origin) { if (!c.origin || !m.origin.includes(c.origin)) return null; why.push('valmistettu ' + c.origin); }
    if (m.anyOf) { const f = m.anyOf.find(k => c[k]); if (!f) return null; why.push(f === 'importFlag' ? 'tuontiauto' : 'aiempi ulkomainen rekisteri'); }
    if (m.tesla && m.tesla.battery) { if (!c.teslaBattery || !m.tesla.battery.includes(c.teslaBattery)) return null; why.push('VIN pos 7 = ' + c.teslaBattery); }
    if (m.kwh) { if (!inRange(c.kwh, m.kwh)) return null; why.push(c.kwh + ' kWh'); }
    if (m.kmPerYear) { if (!inRange(c.kmPerYear, m.kmPerYear)) return null; why.push(fmt(c.kmPerYear) + ' km/v'); }
    if (m.ageMin) { if (c.age == null || c.age < m.ageMin) return null; why.push(Math.round(c.age) + ' v'); }
    return why;
  }
  function profileMatches(c) {
    const out = [];
    for (const r of window.ISSUES_DB) { const why = matchRule(r, c); if (why) out.push({ rule: r, why }); }
    return out.sort((a, b) => b.rule.sev - a.rule.sev);
  }

  /* ---------- Haku ---------- */
  async function run(q) {
    q = (q || '').trim(); if (!q) return;
    state.q = q; state.type = VINLIB.detectType(q);
    Object.assign(state, { vin: null, plate: null, plateInfo: null, local: null, nhtsa: null, recalls: null, complaints: null, ratings: null, reg: null, peer: null, probe: null, nhtsaErr: null, recallsErr: null, complaintsErr: null, ratingsErr: null, regErr: null, peerErr: null, probeErr: null });
    try { history.replaceState(null, '', '?q=' + enc(q)); } catch { }
    $('#results').hidden = false; $('#intro').hidden = true;
    if (state.type === 'vin' || state.type === 'vin-partial') { state.vin = VINLIB.clean(q); state.local = VINLIB.decodeVin(state.vin); }
    else if (state.type === 'plate') { state.plateInfo = VINLIB.parsePlate(q); state.plate = state.plateInfo.plate; }
    else {
      // Vapaa teksti "Merkki Malli Vuosi" (esim. "Tesla Model S 2018") → täytetään käsin syötetyt kentät ja haetaan NHTSA-tiedot niillä
      const yr = q.match(/\b(19[5-9]\d|20[0-4]\d)\b/); const words = q.replace(yr ? yr[0] : '', ' ').trim().split(/\s+/).filter(Boolean);
      if (yr && words.length >= 2) {
        state.type = 'mmy'; state.manual = { ...state.manual, make: words[0], model: words.slice(1).join(' '), year: yr[1] };
        try { localStorage.setItem(LS_KEY, JSON.stringify(state.manual)); } catch { }
      } else state.plateInfo = { ok: false, errors: ['Syöte ei ole VIN (17 merkkiä), rekisteritunnus (ABC-123) eikä muotoa "Merkki Malli Vuosi" (esim. Tesla Model S 2018).'] };
    }
    renderAll();
    const jobs = [];
    if (state.vin) { jobs.push(fetchNhtsaDecode().then(() => { renderAll(); return fetchExtras(); })); jobs.push(fetchProbe()); }
    if (state.plate) jobs.push(fetchReg().then(() => { renderAll(); return fetchExtras(); }));
    if (!state.vin && !state.plate) jobs.push(fetchExtras());
    await Promise.allSettled(jobs);
    renderAll();
  }
  async function fetchNhtsaDecode() {
    const d0 = demoFor(); if (d0) { state.nhtsa = d0.nhtsa; return; }
    if (DEMO) { state.nhtsaErr = 'live-haku ei ole käytössä demossa (ei verkkoa). Omalla palvelimella NHTSA dekoodaa minkä tahansa VIN:n.'; return; }
    try { const d = await getJSON('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/' + state.vin + '?format=json', '/api/vin/' + state.vin); state.nhtsa = (d.Results && d.Results[0]) || null; }
    catch (e) { state.nhtsaErr = String(e.message || e); }
  }
  async function fetchExtras() {
    const c = ctx(); if (!c.make || !c.model || !c.year) return;
    const q = 'make=' + enc(c.make) + '&model=' + enc(c.model) + '&modelYear=' + enc(c.year);
    const d0 = demoFor();
    if (DEMO) {
      if (d0) {
        state.recalls = d0.recalls; state.ratings = d0.ratings;
        state.complaints = []; Object.entries(d0.complaintsByComponent).forEach(([k, n]) => { for (let i = 0; i < n; i++) state.complaints.push({ components: k }); });
        state.complaints.slice(0, d0.complaintsMeta.crash).forEach(x => x.crash = true); state.complaints.slice(0, d0.complaintsMeta.fire).forEach(x => x.fire = true); if (state.complaints[0]) state.complaints[0].numberOfInjuries = d0.complaintsMeta.injuries;
      } else { state.recallsErr = state.complaintsErr = state.ratingsErr = 'ei käytössä demossa'; }
      await Promise.allSettled([fetchPeer(c), fetchFingerprints(c)]); return;
    }
    await Promise.allSettled([
      getJSON('https://api.nhtsa.gov/recalls/recallsByVehicle?' + q, '/api/recalls?' + q).then(d => state.recalls = d.results || []).catch(e => state.recallsErr = String(e.message || e)),
      (async () => {
        let d = await getJSON('https://api.nhtsa.gov/complaints/complaintsByVehicle?' + q, '/api/complaints?' + q);
        if (!d.count && !(await hasProxy())) { // selainhaku ilman palvelinta: yhdistä versiot ("MODEL S 75D", ...) kuten server.js tekee
          const list = await getJSON('https://api.nhtsa.gov/products/vehicle/models?modelYear=' + enc(c.year) + '&make=' + enc(c.make) + '&issueType=c');
          const variants = [...new Set((list.results || []).map(x => String(x.model || '')).filter(m => up(m).startsWith(up(c.model) + ' ')))].slice(0, 10);
          const parts = await Promise.allSettled(variants.map(m => getJSON('https://api.nhtsa.gov/complaints/complaintsByVehicle?make=' + enc(c.make) + '&model=' + enc(m) + '&modelYear=' + enc(c.year))));
          const seen = new Set(), results = [];
          for (const r of parts) if (r.status === 'fulfilled') for (const x of r.value.results || []) if (!seen.has(x.odiNumber)) { seen.add(x.odiNumber); results.push(x); }
          d = { count: results.length, results };
        }
        state.complaints = d.results || [];
      })().catch(e => state.complaintsErr = String(e.message || e)),
      (async () => {
        let l = await getJSON('https://api.nhtsa.gov/SafetyRatings/modelyear/' + enc(c.year) + '/make/' + enc(c.make) + '/model/' + enc(c.model), '/api/ratings?' + q);
        if (!l.Count && !(await hasProxy())) { // NHTSA nimeää mallit versioittain ("MODEL S 75D") → ensimmäinen samalla alkava
          const all = await getJSON('https://api.nhtsa.gov/SafetyRatings/modelyear/' + enc(c.year) + '/make/' + enc(c.make));
          const m = (all.Results || []).find(x => up(x.Model).startsWith(up(c.model) + ' '));
          if (m) l = await getJSON('https://api.nhtsa.gov/SafetyRatings/modelyear/' + enc(c.year) + '/make/' + enc(c.make) + '/model/' + enc(m.Model));
        }
        const id = l.Results && l.Results[0] && l.Results[0].VehicleId; if (!id) return;
        const r = await getJSON('https://api.nhtsa.gov/SafetyRatings/VehicleId/' + id, '/api/ratings/' + id); state.ratings = r.Results && r.Results[0];
      })().catch(e => state.ratingsErr = String(e.message || e)),
      fetchPeer(c), fetchFingerprints(c),
    ]);
  }
  async function fetchReg() {
    if (!(await hasProxy())) return;
    try {
      const d = await getJSON(null, '/api/reg/' + enc(state.plate));
      if (d && d.ok) {
        state.reg = d.vehicle;
        const v = VINLIB.clean(d.vehicle.vin || '');
        if (VINLIB.detectType(v) === 'vin') { state.vin = v; state.local = VINLIB.decodeVin(v); await fetchNhtsaDecode(); fetchProbe(); }
      } else state.regErr = (d && d.error) || 'ei tulosta';
    }
    catch (e) { state.regErr = String(e.message || e); }
  }
  async function fetchProbe() {
    const d0 = demoFor(); if (d0) { state.probe = d0.probe; renderAccident(); return; }
    if (!(await hasProxy())) return;
    try { state.probe = await getJSON(null, '/api/probe?vin=' + enc(state.vin)); } catch (e) { state.probeErr = String(e.message || e); }
    renderAccident();
  }
  async function loadData(name, cacheKey) {
    if (DEMO) return name.startsWith('peer') ? DEMO.peer : DEMO.fp;
    if (window[cacheKey]) return window[cacheKey];
    const r = await fetch('data/' + name, { cache: 'no-store' }); if (!r.ok) throw new Error('ei tiedostoa');
    return (window[cacheKey] = await r.json());
  }
  async function fetchPeer(c) {
    try {
      const d = await loadData('peer_stats.json', '__peerStats');
      const key = normKey(c) + '|' + c.year; state.peer = d[key] || null; state.peerKey = key;
      if (!state.peer) { const alt = Object.keys(d).find(k => k.startsWith(up(c.make) + '|') && k.endsWith('|' + c.year) && normKey(c).includes(k.split('|')[1])); if (alt) { state.peer = d[alt]; state.peerKey = alt; } }
    } catch { state.peerErr = 'Vertaisryhmätilasto puuttuu (aja tools/build_peer_stats.py).'; }
  }
  async function fetchFingerprints(c) {
    try { const d = await loadData('fingerprints.json', '__fp'); state.fp = d[normKey(c)] || null; state.fpKeys = Object.keys(d); } catch { state.fpErr = 'Sormenjälkiaineisto puuttuu (build_peer_stats.py --fingerprint "MERKKI|MALLI").'; }
  }

  /* ---------- Riskiliput ---------- */
  function riskFlags() {
    const f = []; const c = ctx(); const L = state.local;
    if (L) {
      L.errors.forEach(e => f.push(['bad', e])); L.warnings.forEach(w => f.push(['warn', w]));
      if (L.checkDigit && L.checkDigit.valid) f.push(['ok', 'VIN:n tarkistusnumero täsmää.']);
      if (!EU_ETA.includes(L.region) && L.region !== 'Japani' && L.region !== 'Etelä-Korea')
        f.push([L.brand === 'tesla' ? 'info' : 'warn', 'Valmistettu alueella "' + L.region + '"' + (L.brand === 'tesla' ? ' – Teslalla normaalia (EU-autotkin Fremontista/Shanghaista). Varmista silti onko yksilö alun perin EU-myyty vai USA/Norja-tuonti.' : ' – todennäköinen tuontiauto.') + ' Varmista autoveropäätös (vero.fi) ja aiempi rekisteröintihistoria; USA-autoissa NMVTIS/Carfax (salvage title).']);
    }
    if (state.nhtsa && state.nhtsa.ErrorCode && !/^0/.test(state.nhtsa.ErrorCode)) f.push(['warn', 'NHTSA ei dekoodannut VIN:iä kokonaan: ' + state.nhtsa.ErrorText]);
    if (state.nhtsa && state.manual.year && state.nhtsa.ModelYear && String(state.manual.year) !== String(state.nhtsa.ModelYear)) f.push(['bad', 'Ilmoitettu vuosimalli ' + state.manual.year + ' ≠ VIN:n mallivuosi ' + state.nhtsa.ModelYear + '.']);
    if (state.recalls) f.push(state.recalls.length ? [state.recalls.length > 5 ? 'warn' : 'info', state.recalls.length + ' NHTSA-takaisinkutsua (malli/vuosi). Varmista että kampanjat on tehty tälle yksilölle (valmistajan VIN-haku).'] : ['ok', 'Ei NHTSA-takaisinkutsuja tälle malli/vuosi-yhdistelmälle.']);
    if (state.complaints && state.complaints.length > 150) f.push(['warn', state.complaints.length + ' NHTSA-omistajavalitusta – mallilla on kroonisia vikoja.']);
    if (state.peer && c.km) {
      const ratio = c.km / state.peer.km_median;
      if (ratio > 1.6) f.push(['warn', 'Mittarilukema ' + fmt(c.km) + ' km on ' + Math.round((ratio - 1) * 100) + ' % yli saman mallin/vuoden mediaanin Suomessa (' + fmt(state.peer.km_median) + ' km).']);
      else if (ratio < 0.45 && c.year < new Date().getFullYear() - 3) f.push(['warn', 'Mittarilukema on vain ' + Math.round(ratio * 100) + ' % mediaanista. Pyydä katsastushistorian lukemat Traficomista – mittarimanipulaatio on yleistä tuontiautoissa.']);
      else f.push(['ok', 'Mittarilukema on normaalilla alueella vertaisryhmään nähden.']);
    }
    const pm = profileMatches(c); const s3 = pm.filter(x => x.rule.sev === 3).length, s2 = pm.filter(x => x.rule.sev === 2).length;
    if (s3) f.push(['warn', s3 + ' vakavaa komponenttiriskiä tämän yksilön kokoonpanossa – katso "Yksilöllinen riskiprofiili".']);
    else if (s2) f.push(['info', s2 + ' merkittävää tarkistuskohdetta riskiprofiilissa.']);
    if (c.make && !c.engineCode && !c.ev && window.ISSUES_DB.some(r => r.match.engine)) f.push(['info', 'Moottorikoodi puuttuu → ' + window.ISSUES_DB.filter(r => r.match.engine).length + ' moottorikohtaista sääntöä ei voitu tarkistaa. Koodi löytyy moottorin tarrasta/lohkosta, rekisteröintitodistuksesta (osa valmistajista) tai Biltema/Motonet-rekkarihausta.']);
    if (state.probe && state.probe.some(p => p.status === 'hit')) f.push(['bad', 'VIN löytyy vauriohuutokaupan arkistosta (' + state.probe.filter(p => p.status === 'hit').map(p => p.name).join(', ') + ') – auto on todennäköisesti lunastettu ja korjattu. Katso kuvat.']);
    if (state.plate && !state.reg) f.push(['info', 'Rekisteritunnuksella kattavin laillinen lähde on Traficomin Oma asiointi. Täydennä merkki/malli/vuosi alla niin loput kortit toimivat.']);
    return f;
  }
  const riskScore = (flags) => Math.min(100, flags.reduce((s, [l]) => s + (l === 'bad' ? 35 : l === 'warn' ? 12 : 0), 0));

  /* ---------- Render ---------- */
  function renderAll() {
    const c = ctx();
    $('#title').textContent = [c.make, c.model, c.year].filter(Boolean).join(' ') || (state.vin ? 'VIN ' + state.vin : state.plate || '');
    $('#sub').textContent = [state.vin ? 'VIN ' + state.vin : '', state.plate ? 'Rekisteritunnus ' + state.plate : '', c.engineCode ? 'moottori ' + c.engineCode : '', c.kwh ? c.kwh + ' kWh' : ''].filter(Boolean).join(' · ');
    renderRisk(); renderProfile(); renderLocal(); renderNhtsa(); renderReg(); renderManual(); renderAccident(); renderInspection(); renderFingerprint(); renderRecalls(); renderComplaints(); renderPeer(); renderTax(); renderRatings(); renderLinks();
  }
  function card(id) { const el = $('#' + id); el.innerHTML = ''; return el; }
  function kvList(pairs) { const dl = h('dl', { class: 'kv' }); pairs.forEach(([k, v]) => dl.append(h('dt', {}, k), h('dd', { html: '<b>' + esc(v) + '</b>' }))); return dl; }
  const flagEl = (lvl, txt) => h('div', { class: 'flag ' + lvl }, h('span', { class: 'ic' }, { bad: '⛔', warn: '⚠️', ok: '✅', info: 'ℹ️' }[lvl]), h('span', {}, txt));
  const linkChip = (href, label, cls) => h('a', { href, target: '_blank', rel: 'noopener' }, label, cls ? h('span', { class: 'st ' + cls }, cls === 'bad' ? '€' : cls === 'ok' ? 'ilmainen' : cls) : null);

  function renderRisk() {
    const el = card('risk'); const flags = riskFlags(); const score = riskScore(flags);
    const g = score >= 50 ? 'var(--bad)' : score >= 20 ? 'var(--warn)' : 'var(--ok)';
    el.append(h('h2', {}, 'Punaiset liput', h('span', { class: 'st' }, flags.length + ' havaintoa')));
    el.append(h('div', { class: 'score' }, h('div', { class: 'gauge', style: '--p:' + score + ';--g:' + g }, h('div', {}, score)), h('div', {}, h('div', { style: 'font-weight:700;font-size:18px' }, score >= 50 ? 'Pysähdy ja selvitä' : score >= 20 ? 'Tarkista ennen kauppaa' : 'Ei hälyttävää'), h('div', { class: 'empty' }, 'Pisteet: virhe 35, varoitus 12. Ei korvaa Traficomin tietoja eikä koeajoa.'))));
    const box = h('div', { style: 'margin-top:10px' }); flags.forEach(([l, t]) => box.append(flagEl(l, t))); if (!flags.length) box.append(h('div', { class: 'empty' }, 'Syötä VIN tai rekisteritunnus.')); el.append(box);
  }
  function renderProfile() {
    const el = card('profile'); const c = ctx(); const pm = profileMatches(c);
    el.append(h('h2', {}, 'Yksilöllinen riskiprofiili – tämän auton kokoonpanon tunnetut heikot kohdat', h('span', { class: 'st ' + (pm.some(x => x.rule.sev === 3) ? 'bad' : pm.some(x => x.rule.sev === 2) ? 'warn' : 'ok') }, pm.length + ' osumaa / ' + window.ISSUES_DB.length)));
    const known = [['Moottori', c.engineCode || (c.engineText.trim() || null)], ['Käyttövoima', c.fuel || null], ['Iskutilavuus', c.disp ? c.disp + ' l' : null], ['Vaihteisto', c.trans || null], ['Veto', c.drive || null], ['Akku', c.kwh ? c.kwh + ' kWh' : null], ['Varusteet', c.feat.size ? [...c.feat].join(', ') : null], ['Alkuperä', c.origin || null], ['Ajo/v', c.kmPerYear ? fmt(c.kmPerYear) + ' km' : null]];
    el.append(h('div', { class: 'links', style: 'margin-bottom:8px' }, ...known.map(([k, v]) => h('span', { class: 'st ' + (v ? 'ok' : ''), style: 'margin:2px 4px 2px 0' }, k + ': ' + (v || 'puuttuu')))));
    if (!c.make) return el.append(h('div', { class: 'empty' }, 'Tunnista auto ensin (VIN tai käsin).'));
    if (!pm.length) el.append(h('div', { class: 'empty' }, 'Ei osumia tällä tiedolla. Täydennä moottorikoodi, vaihteisto ja varusteet "Täydennä käsin" -kortissa – säännöt ovat komponenttikohtaisia.'));
    const wrap = h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(300px,1fr))' });
    pm.forEach(({ rule: r, why }) => {
      const sevCls = r.sev === 3 ? 'bad' : r.sev === 2 ? 'warn' : '';
      wrap.append(h('div', { class: 'card', style: 'background:var(--panel2)' },
        h('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap' }, h('span', { class: 'st ' + sevCls }, r.sev === 3 ? 'vakava' : r.sev === 2 ? 'merkittävä' : 'tiedoksi'), h('span', { class: 'st' }, r.comp)),
        h('div', { style: 'font-weight:700;margin-bottom:6px' }, r.title),
        h('div', { style: 'font-size:13px;margin-bottom:6px' }, r.what),
        h('div', { style: 'font-size:13px;margin-bottom:6px' }, h('b', {}, 'Tarkista: '), r.check),
        h('div', { style: 'font-size:13px;color:var(--muted)' }, 'Kustannus: ' + r.cost),
        h('div', { style: 'font-size:12px;color:var(--accent);margin-top:6px' }, 'Osui: ' + why.join(' · '))));
    });
    el.append(wrap);
  }
  function renderLocal() {
    const el = card('local'); const L = state.local;
    el.append(h('h2', {}, 'VIN-tulkinta (paikallinen)', h('span', { class: 'st ok' }, 'ei verkkoa')));
    if (!L) { if (state.plateInfo) el.append(kvList([['Tunnus', state.plateInfo.plate]]), ...(state.plateInfo.notes || state.plateInfo.errors || []).map(n => flagEl('info', n))); else el.append(h('div', { class: 'empty' }, '–')); return; }
    el.append(kvList(L.fields));
    if (L.brandFields.length) { el.append(h('h2', { style: 'margin-top:14px' }, L.brand === 'tesla' ? 'Tesla-dekooderi (Part 565)' : 'Fiat-dekooderi')); el.append(kvList(L.brandFields)); }
  }
  function renderNhtsa() {
    const el = card('nhtsa'); const n = state.nhtsa;
    el.append(h('h2', {}, 'NHTSA vPIC-dekooderi', h('span', { class: 'st live' }, 'live')));
    if (!state.vin) return el.append(h('div', { class: 'empty' }, 'Vaatii VIN:n.'));
    if (!n) return el.append(state.nhtsaErr ? flagEl('warn', 'Haku epäonnistui: ' + state.nhtsaErr + (location.protocol === 'file:' ? ' – avaa sivu server.js:n kautta.' : '')) : h('div', {}, h('span', { class: 'spin' }), ' haetaan…'));
    const want = [['Make', 'Merkki'], ['Model', 'Malli'], ['ModelYear', 'Mallivuosi'], ['Series', 'Sarja'], ['Trim', 'Varustetaso'], ['BodyClass', 'Kori'], ['Doors', 'Ovet'], ['DriveType', 'Vetotapa'], ['TransmissionStyle', 'Vaihteisto'], ['TransmissionSpeeds', 'Vaihteita'], ['ElectrificationLevel', 'Sähköistys'], ['FuelTypePrimary', 'Käyttövoima'], ['EngineModel', 'Moottorimalli'], ['EngineManufacturer', 'Moottorin valmistaja'], ['EngineCylinders', 'Sylinterit'], ['DisplacementL', 'Iskutilavuus (l)'], ['Turbo', 'Turbo'], ['EngineHP', 'Teho (hv)'], ['EngineKW', 'Teho (kW)'], ['BatteryKWh', 'Akku (kWh)'], ['BatteryType', 'Akkutyyppi'], ['EVDriveUnit', 'Moottorit'], ['ChargerLevel', 'Laturi'], ['PlantCountry', 'Valmistusmaa'], ['PlantCity', 'Tehdas'], ['Manufacturer', 'Valmistaja (oik.)'], ['GVWR', 'Kokonaismassaluokka'], ['Seats', 'Istuimet'], ['SteeringLocation', 'Ohjaus'], ['VehicleType', 'Ajoneuvotyyppi'], ['ABS', 'ABS'], ['ESC', 'ESC'], ['AdaptiveCruiseControl', 'Mukautuva vakionopeus'], ['ForwardCollisionWarning', 'Törmäysvaroitin'], ['LaneDepartureWarning', 'Kaistavahti']];
    const pairs = want.filter(([k]) => n[k] && String(n[k]).trim()).map(([k, l]) => [l, n[k]]);
    if (n.ErrorCode && n.ErrorCode !== '0') el.append(flagEl('warn', 'NHTSA: ' + n.ErrorText));
    el.append(pairs.length ? kvList(pairs) : h('div', { class: 'empty' }, 'NHTSA ei tunnista tätä VIN:iä (EU-auto?). Täydennä merkki/malli/vuosi käsin.'));
    const extra = Object.entries(n).filter(([k, v]) => v && String(v).trim() && !want.some(w => w[0] === k) && !['ErrorCode', 'ErrorText', 'VIN', 'AdditionalErrorText', 'SuggestedVIN', 'PossibleValues'].includes(k));
    if (extra.length) { const d = h('details', {}, h('summary', {}, 'Kaikki ' + extra.length + ' lisäkenttää')); d.append(kvList(extra)); el.append(d); }
  }
  function renderReg() {
    const el = card('reg');
    el.append(h('h2', {}, 'Rekisteritunnushaku (Suomi)', h('span', { class: 'st ' + (state.reg ? 'ok' : '') }, state.reg ? state.reg.source || 'proxy' : 'linkit')));
    if (!state.plate) return el.append(h('div', { class: 'empty' }, 'Vaatii rekisteritunnuksen. Näyttää suorat linkit Bilteman ja Traficomin hakuihin valmiiksi rekkarilla.'));
    if (state.reg) return el.append(kvList(Object.entries(state.reg).filter(([k, v]) => v != null && v !== '' && k !== 'raw').map(([k, v]) => [k, v])));
    el.append(flagEl('info', state.regErr || 'Suomessa ei ole avointa rekkari→auto-rajapintaa. Avaa linkit, lue tiedot ja täydennä ne käsin – sen jälkeen koko raportti toimii.'));
    el.append(h('div', { class: 'links' },
      linkChip('https://www.biltema.fi/auton-varaosahaku/' + enc(state.plate) + '/', 'Biltema: merkki, malli, vuosi, moottorikoodi (ei kirjautumista)', 'ok'),
      linkChip('https://asiointi.traficom.fi/omatraficom/', 'Traficom Oma asiointi: tekniset tiedot, vero, katsastus, massa, CO2', 'warn'),
      linkChip('https://www.google.com/search?q=' + enc('"' + state.plate + '"'), 'Google rekkarilla (vanhat ilmoitukset)', 'ok')));
    el.append(h('div', { class: 'empty' }, 'Vinkki: Biltema näyttää moottorikoodin (esim. CFFB) – se on riskiprofiilin tärkein yksittäinen tieto.'));
  }

  /* ---------- Onnettomuudet & kuvat ---------- */
  function renderAccident() {
    const el = card('accident'); const c = ctx(); const id = c.vin || c.plate;
    const hits = state.probe ? state.probe.filter(p => p.status === 'hit') : [];
    el.append(h('h2', {}, 'Onnettomuudet, lunastukset ja kuvat', h('span', { class: 'st ' + (hits.length ? 'bad' : state.probe ? 'ok' : 'warn') }, hits.length ? hits.length + ' arkisto-osumaa' : state.probe ? 'luotaimet: ei osumia' : 'luotaimet vaativat server.js')));
    if (!id) return el.append(h('div', { class: 'empty' }, 'Vaatii VIN:n tai rekisteritunnuksen.'));
    if (state.probe) {
      const ul = h('ul', { class: 'list' });
      state.probe.forEach(p => ul.append(h('li', {}, h('span', { class: 'st ' + (p.status === 'hit' ? 'bad' : p.status === 'none' ? 'ok' : 'warn'), style: 'margin-right:8px' }, p.status === 'hit' ? 'OSUMA' : p.status === 'none' ? 'ei osumaa' : 'ei tarkistettu'), h('a', { href: p.url, target: '_blank', rel: 'noopener' }, p.name), p.note ? h('small', {}, p.note) : null)));
      el.append(h('details', { open: hits.length > 0 }, h('summary', {}, 'Automaattiluotaimet (kokeellinen: hakee VIN:n vauriohuutokauppojen julkisista arkistoista)'), ul));
    } else if (state.probeErr) el.append(flagEl('warn', 'Luotaimet epäonnistuivat: ' + state.probeErr));
    el.append(h('div', { class: 'flag info' }, h('span', { class: 'ic' }, 'ℹ️'), h('span', {}, 'Suomessa mikään viranomainen ei pidä julkista kolarirekisteriä. Vakuutusyhtiöiden vahinkotiedot eivät ole saatavilla. Parhaat jäljet: (1) huutokauppa-arkistojen kuvat VIN:llä, (2) vanhat myynti-ilmoitukset, (3) Traficomin historiatiedoista "rekisteröintikatsastus" kesken elinkaaren tai pitkä liikennekäytöstäpoisto = lunastettu ja korjattu, (4) oma silmä: maalikerrosmittari, saumat, pulttien jäljet, turvatyynyvalo.')));
    const sections = [];
    if (c.vin) {
      sections.push(['Kuvahaut VIN:llä', [
        ['https://www.google.com/search?tbm=isch&q=' + enc('"' + c.vin + '"'), 'Google Kuvat', 'ok'], ['https://yandex.com/images/search?text=' + enc(c.vin), 'Yandex Kuvat (löytää huutokauppakuvat parhaiten)', 'ok'], ['https://www.bing.com/images/search?q=' + enc('"' + c.vin + '"'), 'Bing Kuvat', 'ok'], ['https://www.google.com/search?q=' + enc('"' + c.vin + '"'), 'Google (kaikki)', 'ok']]]);
      sections.push(['Vauriohuutokauppojen arkistot (USA/Kanada/EU – kuvat ennen korjausta)', [
        ['https://www.copart.com/lotSearchResults/?free=true&query=' + enc(c.vin), 'Copart', 'ok'], ['https://www.iaai.com/Search?Keyword=' + enc(c.vin), 'IAAI', 'ok'],
        ['https://www.google.com/search?q=' + enc(c.vin + ' site:bidfax.info OR site:poctra.com OR site:stat.vin OR site:bid.cars OR site:autobidmaster.com OR site:carsfromwest.com OR site:plc.auction'), 'Arkistoindeksit (bidfax, poctra, stat.vin, bid.cars…)', 'ok'],
        ['https://www.google.com/search?q=' + enc(c.vin + ' site:autobid.de OR site:autorola.com OR site:bca.co.uk OR site:copart.co.uk OR site:e-vahinko.fi'), 'EU-huutokaupat (autobid, autorola, BCA, Copart UK)', 'ok']]]);
      sections.push(['Viralliset historiaraportit', [
        ['https://vehiclehistory.bja.ojp.gov/nmvtis_vehiclehistory', 'NMVTIS (USA title: salvage/junk/flood, ~5 $)', 'bad'], ['https://www.carfax.com/VehicleHistory/p/Report.cfx?vin=' + enc(c.vin), 'Carfax (USA/Kanada kolarit, mittarit, ~40 $)', 'bad'], ['https://www.autocheck.com/vehiclehistory/search-by-vin?vin=' + enc(c.vin), 'AutoCheck (USA)', 'bad'],
        ['https://www.carvertical.com/fi/landing/v3?vin=' + enc(c.vin), 'carVertical (EU+USA, kuvat vanhoista ilmoituksista)', 'bad'], ['https://www.autodna.com/vin/' + enc(c.vin), 'autoDNA (EU)', 'bad']]]);
    }
    sections.push(['Suomi: lunastetut ja vanhat ilmoitukset', [
      ['https://www.avk.fi/', 'AVK Autovahinkokeskus (vakuutusyhtiöiden lunastamat)', 'ok'], ['https://www.google.com/search?q=' + enc('site:avk.fi ' + [c.make, c.model].filter(Boolean).join(' ')), 'AVK-arkisto Googlella', 'ok'],
      c.plate ? ['https://www.google.com/search?tbm=isch&q=' + enc('"' + c.plate + '"'), 'Google Kuvat rekkarilla', 'ok'] : null, c.plate ? ['https://www.google.com/search?q=' + enc('"' + c.plate + '" OR "' + c.plate.replace('-', '') + '" site:nettiauto.com OR site:tori.fi OR site:autotalli.com OR site:kamux.fi'), 'Vanhat myynti-ilmoitukset rekkarilla', 'ok'] : null,
      ['https://www.google.com/search?q=' + enc([c.make, c.model, c.year, 'kolari OR lunastettu OR vaurioitunut OR "myydään vaurioituneena"'].filter(Boolean).join(' ')), 'Vaurioituneena myydyt (malli)', 'ok']].filter(Boolean)]);
    sections.forEach(([t, links]) => { el.append(h('div', { style: 'color:var(--muted);font-size:12px;margin:10px 0 2px;text-transform:uppercase;letter-spacing:.06em' }, t)); el.append(h('div', { class: 'links' }, ...links.map(([u, l, cls]) => linkChip(u, l, cls)))); });
    el.append(h('details', {}, h('summary', {}, 'Kolarikorjauksen merkit paikan päällä'), h('ul', { style: 'font-size:13px;padding-left:18px' },
      h('li', {}, 'Maalikerrosmittari: tehdasmaali 90–150 µm; 250+ µm = kitattu/maalattu. Mittaa jokainen pelti ja katto.'),
      h('li', {}, 'Saumat ja raot: epätasaiset ovien/konepellin raot, vinot puskurit, eri sävyinen maali valossa 45°.'),
      h('li', {}, 'Pulttien jäljet: lokasuojien, konepellin ja ovien kiinnityspultit – avatut pultit paljastavat vaihdetun osan. Tesla S: alumiinipellit, korjaus vain merkkikorjaamolla.'),
      h('li', {}, 'Turvatyynyt: valon pitää syttyä ja sammua käynnistyksessä. Vikamuisti SRS. Uudet turvatyynykannet eri sävyllä.'),
      h('li', {}, 'Alta: vääntyneet apurungon kiinnikkeet, uudet jäähdyttimen tukipalkit, hitsaussaumat ilman tehdasmassaa, uusi alustasuoja vain yhdellä puolella.'),
      h('li', {}, 'Lasit: kaikkien lasien valmistusvuoden pitää olla sama (merkintä kulmassa) – tuulilasin vaihto ok, sivulasi + takalasi = epäilyttävä.'))));
  }

  /* ---------- Katsastushistoria ---------- */
  function renderInspection() {
    const el = card('inspection'); const c = ctx();
    el.append(h('h2', {}, 'Katsastushistoria ja mittarilukemat', h('span', { class: 'st warn' }, 'ohjattu')));
    const steps = h('ol', { style: 'font-size:13px;padding-left:18px;margin:0 0 8px' },
      h('li', {}, h('b', {}, 'Ilmaiseksi (Traficom Oma asiointi, tunnistautuminen): '), 'edellinen katsastus (pvm, tulos), seuraava katsastus viimeistään, liikennekäyttötila, veron tila, rekisteröintikiellot. Jos "Rekisteröintikatsastus" näkyy ensirekisteröinnin jälkeen → auto on ollut poistettuna (lunastus/tuonti) – kysy miksi.'),
      h('li', {}, h('b', {}, 'Muutamalla eurolla (Traficomin historiatiedot / rekkari.fi / Autotieto): '), 'kaikki katsastukset mittarilukemineen, omistajien lukumäärä, liikennekäytöstäpoistot. Piirrä lukemat aikajanalle: lasku tai tasainen jakso = manipulaatio tai pitkä seisonta.'),
      h('li', {}, h('b', {}, 'Tuontiauto: '), 'aiempi ulkomainen rekisteri näyttää katsastukset ja kilometrit yleensä ilmaiseksi (syötä vanha rekisteritunnus "Täydennä käsin" -korttiin → linkit tähän).'),
      h('li', {}, h('b', {}, 'Mallikohtainen tausta: '), 'Traficomin katsastuksen vikatilasto kertoo mistä tämä malli hylätään tässä ikäluokassa – pyydä katsastusasemalta kuntotarkastus juuri niihin kohtiin.'));
    el.append(steps);
    const links = [['https://asiointi.traficom.fi/omatraficom/', 'Traficom Oma asiointi', 'ok'], ['https://www.traficom.fi/fi/liikenne/tieliikenne/ajoneuvon-tiedot-ja-historia', 'Traficom: ajoneuvon historiatiedot (maksullinen raportti)', 'bad'], ['https://rekkari.fi/tarkista-ajoneuvon-tiedot', 'rekkari.fi (2,90 €→)', 'bad'], ['https://www.traficom.fi/fi/tilastot/katsastustilastot', 'Traficom katsastustilastot (malli/ikä)', 'ok']];
    const fr = c.foreignReg; const fc = c.foreignCountry;
    const foreign = { SE: ['https://biluppgifter.se/fordon/' + enc(fr), 'Ruotsi: biluppgifter.se (besiktning + mätarställning, ilmainen)'], NO: ['https://www.vegvesen.no/kjoretoy/kjop-og-salg/kjoretoyopplysninger?registreringsnummer=' + enc(fr), 'Norja: Statens vegvesen (EU-kontroll, ilmainen)'], DK: ['https://www.tjekbil.dk/nummerplade/' + enc(fr), 'Tanska: tjekbil.dk (syn + km, ilmainen)'], UK: ['https://www.check-mot.service.gov.uk/results?registration=' + enc(fr), 'UK: MOT history (viat + mailit, ilmainen)'], EE: ['https://eteenindus.mnt.ee/public/soidukTaustakontroll.jsf', 'Viro: Transpordiamet taustakontroll (ilmainen)'], DE: ['https://www.google.com/search?q=' + enc('"' + fr + '" mobile.de OR autoscout24.de'), 'Saksa: ei julkista rekisteriä – etsi vanha ilmoitus, pyydä TÜV-raportti'], US: ['https://www.carfax.com/VehicleHistory/p/Report.cfx?vin=' + enc(c.vin || ''), 'USA: Carfax (inspection/emissions-mittarilukemat osavaltioittain)'], NL: ['https://ovi.rdw.nl/', 'Alankomaat: RDW kentekencheck (APK-historia, ilmainen)'], BE: ['https://www.google.com/search?q=' + enc('"' + fr + '" carpass'), 'Belgia: Car-Pass (mittarihistoria myyjältä)'] };
    if (fc && foreign[fc]) links.push([foreign[fc][0], foreign[fc][1], 'ok']);
    else if (c.importFlag) links.push(['#manual', 'Syötä aiempi ulkomainen rekisteritunnus ja maa → suora linkki sen maan katsastusrekisteriin', 'warn']);
    el.append(h('div', { class: 'links' }, ...links.map(([u, l, cls]) => linkChip(u, l, cls))));
    if (c.km && c.year) {
      const t = h('div', { class: 'empty' }, 'Odotettava lukema: Suomen henkilöauto ajaa keskimäärin ~17 000 km/v → ' + fmt(Math.round(17000 * c.age)) + ' km tässä iässä; tämä auto ' + fmt(c.km) + ' km (' + fmt(c.kmPerYear) + ' km/v).' + (state.peer ? ' Saman mallin mediaani Suomessa ' + fmt(state.peer.km_median) + ' km.' : ''));
      el.append(t);
    }
  }

  /* ---------- Avoimen datan sormenjälki ---------- */
  function renderFingerprint() {
    const el = card('fingerprint'); const c = ctx();
    el.append(h('h2', {}, 'Avoimen datan sormenjälki – yksilön viimeisin katsastuskilometri', h('span', { class: 'st ' + (state.fp ? 'ok' : '') }, state.fp ? state.fp.length + ' ehdokasta kannassa' : 'tilasto')));
    el.append(h('div', { class: 'empty' }, 'Traficomin avoin data ei sisällä rekkaria, mutta merkki + malli + ensirekisteröintipäivä + väri + kunta rajaavat usein yhteen autoon – ja rivillä on viimeisin katsastuksessa todettu mittarilukema. Täysin laillinen (CC BY 4.0), aineisto on päivämäärän tilannekuva.'));
    if (!c.make) return;
    if (!state.fp) return el.append(flagEl('info', state.fpErr || 'Ei sormenjälkiaineistoa mallille ' + normKey(c) + '. Aja: python3 tools/build_peer_stats.py data.csv --fingerprint "' + normKey(c) + '"' + (state.fpKeys ? ' (kannassa: ' + state.fpKeys.join(', ') + ')' : '')));
    let cands = state.fp;
    const why = [];
    if (c.firstReg) { cands = cands.filter(r => (r[0] || '').startsWith(c.firstReg)); why.push('ensirek. ' + c.firstReg); }
    if (c.year && !c.firstReg) { cands = cands.filter(r => (r[0] || '').startsWith(String(c.year))); why.push('vuosi ' + c.year); }
    if (c.color) { cands = cands.filter(r => r[2] === c.color); why.push('väri ' + c.color); }
    if (c.kunta) { cands = cands.filter(r => up(r[3]) === up(c.kunta)); why.push('kunta ' + c.kunta); }
    el.append(h('div', { class: 'empty' }, 'Suodatus: ' + (why.join(' · ') || 'ei suodattimia – syötä ensirekisteröintipäivä, väri ja kunta "Täydennä käsin" -korttiin') + ' → ' + cands.length + ' ehdokasta'));
    if (cands.length === 1) el.append(flagEl('ok', 'Yksi ehdokas: viimeisin katsastuksessa todettu lukema ' + fmt(cands[0][4]) + ' km' + (c.km ? (c.km < cands[0][4] ? ' – ILMOITETTU ' + fmt(c.km) + ' KM ON PIENEMPI → mittarimanipulaatioepäily' : ' (ilmoitettu nyt ' + fmt(c.km) + ' km, +' + fmt(c.km - cands[0][4]) + ')') : '') + '.'));
    if (cands.length > 1 && cands.length <= 40) {
      const t = h('table', { class: 'src' }, h('thead', {}, h('tr', {}, h('th', {}, 'Ensirek.'), h('th', {}, 'Käyttöönotto'), h('th', {}, 'Väri'), h('th', {}, 'Kunta'), h('th', {}, 'Mittari km'), h('th', {}, 'Omamassa'), h('th', {}, 'Käyttövoima'))));
      const tb = h('tbody'); cands.slice(0, 40).forEach(r => tb.append(h('tr', {}, h('td', {}, r[0]), h('td', {}, r[1]), h('td', {}, r[2]), h('td', {}, r[3]), h('td', { class: 'num' }, fmt(r[4])), h('td', { class: 'num' }, fmt(r[5])), h('td', {}, r[7] || '')))); t.append(tb); el.append(t);
    } else if (cands.length > 40) el.append(h('div', { class: 'empty' }, 'Liikaa ehdokkaita – lisää suodattimia.'));
  }

  function renderRecalls() {
    const el = card('recalls'); const r = state.recalls;
    el.append(h('h2', {}, 'Takaisinkutsut (NHTSA, USA)', h('span', { class: 'st ' + (r ? (r.length ? 'warn' : 'ok') : 'live') }, r ? r.length + ' kpl' : 'live')));
    if (!r) return el.append(h('div', { class: 'empty' }, state.recallsErr ? 'Haku epäonnistui: ' + state.recallsErr : ctx().make ? h('span', {}, h('span', { class: 'spin' }), ' haetaan…') : 'Vaatii merkki + malli + vuosi.'));
    if (!r.length) return el.append(h('div', { class: 'empty' }, 'Ei kampanjoita. EU-takaisinkutsut: Traficom/Safety Gate -linkit.'));
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
    if (!p) return el.append(h('div', { class: 'empty' }, state.peerErr || (c.make ? 'Ei osumaa avaimella ' + (state.peerKey || '') + '.' : 'Vaatii merkki + malli + vuosi.')));
    const max = Math.max(p.km_p90 || p.km_p75 * 1.3, c.km || 0) * 1.05; const pct = (v) => (v / max * 100).toFixed(1) + '%';
    el.append(h('div', { class: 'empty' }, 'Viimeisin katsastuksen mittarilukema samalla merkki/malli/vuosi-yhdistelmällä (' + (p.as_of || 'aineiston pvm') + ').'));
    const bar = h('div', { class: 'bar' }, h('div', { class: 'rng', style: 'left:' + pct(p.km_p25) + ';width:' + pct(p.km_p75 - p.km_p25) }), h('div', { class: 'med', style: 'left:' + pct(p.km_median) }));
    if (c.km) bar.append(h('div', { class: 'you', style: 'left:' + pct(c.km), title: 'tämä auto' }));
    el.append(bar, h('div', { class: 'axis' }, h('span', {}, '0'), h('span', {}, fmt(Math.round(max / 1000)) + ' tkm')));
    el.append(kvList([['Mediaani', fmt(p.km_median) + ' km'], ['Kvartiilit 25–75 %', fmt(p.km_p25) + ' – ' + fmt(p.km_p75) + ' km'], ['Keskiarvo', fmt(p.km_mean) + ' km'], ['Tämä auto', c.km ? fmt(c.km) + ' km' : 'syötä mittarilukema'], ['Omamassa (mediaani)', p.mass_median ? fmt(p.mass_median) + ' kg' : '–'], ['CO2 (mediaani)', p.co2_median != null ? p.co2_median + ' g/km' : '–'], ['Yleisin väri', p.top_color || '–'], ['Yleisin kunta', p.top_kunta || '–']]));
  }
  function renderTax() {
    const el = card('tax'); const c = ctx();
    el.append(h('h2', {}, 'Ajoneuvovero 2026 (arvio)', h('span', { class: 'st ok' }, 'laskuri')));
    const mass = c.mass || c.curb || null; const fuel = c.fuel || 'sahko'; const kv100 = mass ? Math.ceil(mass / 100) : null;
    const rate = TAX_2026.kayttovoima_c_per_day_100kg[fuel]; const kvv = kv100 != null && rate != null ? kv100 * rate * 365 / 100 : null;
    const perus = (fuel === 'sahko' || c.co2 === 0) ? TAX_2026.perusvero_min_eur_year : null;
    const rows = h('div', { class: 'taxout' });
    rows.append(h('span', {}, 'Perusvero (' + (fuel === 'sahko' ? '0 g/km WLTP' : c.co2 != null ? c.co2 + ' g/km' : 'CO2 puuttuu') + ')'), h('span', { class: 'num' }, perus != null ? eur(perus) : 'Traficomin taulukko'));
    rows.append(h('span', {}, 'Käyttövoimavero (' + ({ sahko: 'sähkö 1,9 c', diesel: 'diesel 5,5 c', kaasu: 'kaasu 3,1 c', bensiini: 'bensiini 0 c', hybridi: 'hybridi 0 c', phev: 'lataushybridi 1,95 c' }[fuel] || '?') + '/pv per alkava 100 kg' + (mass ? ', ' + fmt(mass) + ' kg → ' + kv100 + ' × 100 kg' : '') + ')'), h('span', { class: 'num' }, kvv != null ? eur(kvv) : 'massa puuttuu'));
    if (perus != null && kvv != null) rows.append(h('span', { class: 'total' }, 'Yhteensä / vuosi'), h('span', { class: 'num total' }, eur(perus + kvv)));
    el.append(rows, h('div', { class: 'empty' }, 'Massa: ' + (c.mass ? 'kokonaismassa' : c.curb ? 'omamassa (vero lasketaan kokonaismassasta → syötä se)' : 'ei tiedossa') + '. Polttomoottorin perusvero CO2:n mukaan Traficomin taulukosta. 1.1.2026: sähkö 1,5→1,9 c, perusvero min 53→106 €/v.'));
  }
  function renderLinks() {
    const el = card('links'); const c = ctx();
    el.append(h('h2', {}, 'Jatka tästä – syvälinkit lähteisiin'));
    const groups = {};
    SOURCES.forEach(s => { if (s.only && s.only !== (state.local && state.local.brand) && !up(c.make).startsWith(up(s.only))) return; (groups[s.group] = groups[s.group] || []).push(s); });
    for (const [g, list] of Object.entries(groups)) {
      el.append(h('div', { style: 'color:var(--muted);font-size:12px;margin:10px 0 2px;text-transform:uppercase;letter-spacing:.06em' }, g));
      el.append(h('div', { class: 'links' }, ...list.map(s => { let u; try { u = s.url(c); } catch { u = '#'; } return h('a', { href: u, target: '_blank', rel: 'noopener', title: s.gives }, s.name, h('span', { class: 'st ' + accessCls(s.access[0]) }, accessLabel(s.access[0]))); })));
    }
  }
  const accessLabel = (a) => ({ live: 'API', proxy: 'proxy', link: 'linkki', login: 'kirjautuminen', paid: '€', file: 'aineisto' }[a] || a);
  const accessCls = (a) => ({ live: 'live', proxy: 'warn', paid: 'bad', login: 'warn', link: '', file: 'ok' }[a] || '');

  /* ---------- Käsin täydennys ---------- */
  function renderManual() {
    const el = card('manual'); const m = state.manual; const c = ctx();
    el.append(h('h2', {}, 'Täydennä käsin – mitä enemmän, sitä tarkempi profiili', h('span', { class: 'st' }, 'tallentuu selaimeen')));
    const f = h('form', { class: 'manual', onsubmit: (e) => { e.preventDefault(); const fd = new FormData(e.target); const o = {}; for (const [k, v] of fd.entries()) { if (k === 'feat') o.feat = (o.feat ? o.feat + ',' : '') + v; else if (v !== '') o[k] = v; } state.manual = o; try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { } renderAll(); fetchExtras().then(renderAll); } });
    const inp = (name, label, val, type = 'text', ph = '', extra = {}) => h('label', {}, label, h('input', { name, value: val == null ? '' : val, type, placeholder: ph, ...(type === 'number' ? { min: 0, step: 'any' } : {}), ...extra }));
    const sel = (name, label, opts, val) => { const s = h('select', { name }); opts.forEach(([v, l]) => s.append(h('option', { value: v, selected: (val || '') === v }, l))); return h('label', {}, label, s); };
    const sec = (title, open, ...kids) => { const d = h('details', { open, style: 'grid-column:1/-1' }, h('summary', {}, title)); d.append(h('div', { class: 'manual', style: 'margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px' }, ...kids)); return d; };
    f.append(sec('Perustiedot', true,
      inp('make', 'Merkki', m.make || c.make, 'text', 'Tesla'), inp('model', 'Malli (NHTSA-muoto)', m.model || c.model, 'text', 'Model S'), inp('year', 'Vuosimalli', m.year || c.year, 'number', '2018'), inp('km', 'Mittarilukema km', m.km, 'number', '120000'),
      sel('fuel', 'Käyttövoima', [['', 'auto'], ['sahko', 'sähkö'], ['bensiini', 'bensiini'], ['diesel', 'diesel'], ['hybridi', 'hybridi'], ['phev', 'lataushybridi'], ['kaasu', 'kaasu']], m.fuel), inp('mass', 'Kokonaismassa kg', m.mass, 'number', '2600'), inp('curb', 'Omamassa kg', m.curb, 'number', '2100'), inp('co2', 'CO2 g/km (WLTP)', m.co2, 'number', '0')));
    f.append(sec('Tekniikka (riskiprofiili)', true,
      inp('engine', 'Moottorikoodi / perhe', m.engine, 'text', 'esim. CAYC, N47, EA189, OM651'), inp('disp', 'Iskutilavuus l', m.disp || c.disp, 'number', '2.0'), inp('cyl', 'Sylinterit', m.cyl || c.cyl, 'number', '4'),
      sel('turbo', 'Turbo', [['', '?'], ['kyllä', 'kyllä'], ['ei', 'ei']], m.turbo), sel('trans', 'Vaihteisto', [['', '?'], ['manuaali', 'manuaali'], ['automaatti', 'automaatti (momentinmuunnin)'], ['kaksoiskytkin', 'kaksoiskytkin (DSG/DCT/PowerShift/S tronic)'], ['cvt', 'CVT / Multitronic / Lineartronic'], ['ev', 'sähköauto (1-vaihteinen)']], m.trans || c.trans),
      inp('transNote', 'Vaihteiston tyyppi/koodi', m.transNote, 'text', 'esim. DQ200, 7G-Tronic, Jatco'), sel('drive', 'Vetotapa', [['', '?'], ['etu', 'etuveto'], ['taka', 'takaveto'], ['neli', 'neliveto']], m.drive || c.drive), inp('kwh', 'Ajoakku kWh', m.kwh || c.kwh, 'number', '75')));
    const feats = FEATURES.map(([k, l]) => h('label', { style: 'flex-direction:row;align-items:center;gap:6px' }, h('input', { type: 'checkbox', name: 'feat', value: k, checked: c.feat.has(k) }), l));
    f.append(sec('Varusteet', true, ...feats));
    f.append(sec('Sormenjälki & tuonti', true,
      inp('firstReg', 'Ensirekisteröinti (Traficom)', m.firstReg, 'date'), sel('color', 'Väri (Traficom)', [['', '?'], ...COLORS.map(x => [x, x])], m.color), inp('kunta', 'Kunta (haltijan)', m.kunta, 'text', 'Seinäjoki'),
      inp('foreignReg', 'Aiempi ulkomainen rekisteritunnus', m.foreignReg, 'text', 'ABC123'), sel('foreignCountry', 'Tuontimaa', COUNTRIES, m.foreignCountry)));
    f.append(h('div', { style: 'grid-column:1/-1;display:flex;gap:8px' }, h('button', { class: 'btn', type: 'submit' }, 'Päivitä profiili'), h('button', { class: 'btn secondary', type: 'button', onclick: () => { state.manual = {}; try { localStorage.removeItem(LS_KEY); } catch { } renderAll(); } }, 'Tyhjennä käsin syötetyt')));
    el.append(f);
  }

  /* ---------- Lähdekartta ---------- */
  function renderSources() {
    const t = h('table', { class: 'src' }, h('thead', {}, h('tr', {}, h('th', {}, 'Lähde'), h('th', {}, 'Pääsy'), h('th', {}, 'Hakuavain'), h('th', {}, 'Mitä saat'), h('th', {}, 'Tila'))));
    const tb = h('tbody'); let g = null;
    SOURCES.forEach(s => {
      if (s.group !== g) { g = s.group; tb.append(h('tr', { class: 'group' }, h('td', { colspan: 5 }, g))); }
      let u; try { u = s.url(ctx()); } catch { u = '#'; }
      tb.append(h('tr', {}, h('td', {}, h('a', { href: u, target: '_blank', rel: 'noopener' }, s.name), s.note ? h('div', { style: 'color:var(--muted);font-size:12px' }, s.note) : null),
        h('td', {}, ...s.access.map(a => h('span', { class: 'st ' + accessCls(a) }, accessLabel(a)))), h('td', {}, s.by.join(', ')), h('td', {}, s.gives),
        h('td', {}, h('span', { class: 'st ' + (s.verified ? 'ok' : 'warn') }, s.verified ? 'varmistettu' : 'ei testattu'))));
    });
    t.append(tb); $('#sources').append(t);
  }

  function exportJSON() {
    const c = ctx();
    const blob = new Blob([JSON.stringify({ query: state.q, context: { ...c, feat: [...c.feat] }, flags: riskFlags(), profile: profileMatches(c).map(x => ({ id: x.rule.id, title: x.rule.title, sev: x.rule.sev, why: x.why })), local: state.local, nhtsa: state.nhtsa, recalls: state.recalls, complaints: state.complaints && state.complaints.length, ratings: state.ratings, reg: state.reg, peer: state.peer, probe: state.probe, generated: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'autorontgen-' + (state.vin || state.plate || 'raportti') + '.json' }); document.body.append(a); a.click(); a.remove();
  }

  function init() {
    try { state.manual = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { state.manual = {}; }
    $('#form').addEventListener('submit', (e) => { e.preventDefault(); run($('#q').value); });
    $('#clear').addEventListener('click', () => { state.manual = {}; try { localStorage.removeItem(LS_KEY); } catch { } $('#q').value = ''; $('#results').hidden = true; $('#intro').hidden = false; history.replaceState(null, '', location.pathname); });
    $('#print').addEventListener('click', () => window.print());
    $('#json').addEventListener('click', exportJSON);
    $('#share').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(location.href); });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t)); document.querySelectorAll('[data-view]').forEach(v => v.hidden = v.dataset.view !== t.dataset.tab); }));
    document.querySelectorAll('[data-example]').forEach(b => b.addEventListener('click', () => {
      const FALLBACK = { tesla: '5YJSA1E2XJF000001', fiat: '3C3CFFGE9GT000001', passat: 'WVWZZZ3CZCE000001', plate: 'ABC-123' };
      const ex = DEMO && DEMO.examples && DEMO.examples[b.dataset.example];
      if (!ex && FALLBACK[b.dataset.example]) { $('#q').value = FALLBACK[b.dataset.example]; run(FALLBACK[b.dataset.example]); return; }
      if (ex) { state.manual = { ...ex.manual }; try { localStorage.setItem(LS_KEY, JSON.stringify(state.manual)); } catch { } $('#q').value = ex.q; run(ex.q); }
      else { $('#q').value = b.dataset.example; run(b.dataset.example); }
    }));
    if (DEMO) { const bn = $('#demobanner'); if (bn) { bn.hidden = false; bn.textContent = DEMO.label; } ['print', 'json'].forEach(id => { const b = $('#' + id); if (b) b.hidden = true; }); }
    renderSources();
    hasProxy().then(p => { $('#proxy').textContent = p ? 'server.js: yhdistetty (proxy, välimuisti, luotaimet)' : DEMO ? 'demotila: esimerkkidata' : 'server.js: ei käytössä – NHTSA suoraan, ei rekkarihakua eikä luotaimia'; $('#proxy').className = 'st ' + (p ? 'ok' : 'warn'); });
    const q = new URLSearchParams(location.search).get('q'); if (q) { $('#q').value = q; run(q); }
  }
  window.AUTORONTGEN = { run, state, ctx, riskFlags, profileMatches };
  document.addEventListener('DOMContentLoaded', init);
})();
