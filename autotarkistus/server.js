#!/usr/bin/env node
/* Autoröntgen – kevyt palvelin ilman riippuvuuksia (Node 18+).
   - Jakaa staattiset tiedostot
   - Proxyttaa NHTSA-rajapinnat (kiertää CORS:n, välimuisti 1 h)
   - /api/reg/:plate – kokeellinen suomalainen rekisteritunnushaku (adapterit alla, EI dokumentoituja rajapintoja)
   - /api/health
   Käynnistys: node server.js [--port 8787] */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const PORT = Number(process.env.PORT || (args.includes('--port') ? args[args.indexOf('--port') + 1] : 8787));
const HOST = process.env.HOST || (args.includes('--host') ? args[args.indexOf('--host') + 1] : '0.0.0.0');
/* Valinnainen salasanasuojaus: BASIC_AUTH="kayttaja:salasana" ympäristömuuttujana tai --auth kayttaja:salasana.
   Pakollinen jos avaat palvelimen internetiin (reititin/portinohjaus) – muuten kuka tahansa voi käyttää proxya. */
const BASIC_AUTH = process.env.BASIC_AUTH || (args.includes('--auth') ? args[args.indexOf('--auth') + 1] : '');
const ROOT = __dirname;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();
const UA = 'Autorontgen/1.0 (+henkilokohtainen autotarkistus; ei massahakuja)';

/* Rekisteritunnusadapterit. Jokainen palauttaa normalisoidun {make, model, year, engine, power_kw, fuel, source} tai null.
   Huom: nämä ovat kaupallisten varaosakauppojen sivustojen käyttämiä hakuja; rajapinnat ovat dokumentoimattomia ja voivat muuttua.
   Jos adapteri ei toimi, korjaa URL/kentät tässä – sovellus toimii joka tapauksessa Traficom-linkkien kautta. */
const REG_ADAPTERS = [
  {
    name: 'biltema',
    url: (plate) => `https://reg.biltema.com/vehicle/api/vehicle/FI/${encodeURIComponent(plate.replace('-', ''))}`,
    headers: { Accept: 'application/json', Referer: 'https://www.biltema.fi/' },
    map: (d) => {
      const v = Array.isArray(d) ? d[0] : (d && (d.vehicle || d.Vehicle || d));
      if (!v || typeof v !== 'object') return null;
      const pick = (...ks) => { for (const k of ks) { const val = deepGet(v, k); if (val != null && val !== '') return val; } return null; };
      const make = pick('brand', 'Brand', 'make', 'Make', 'manufacturer', 'carBrand');
      if (!make) return null;
      return { make, model: pick('model', 'Model', 'carModel', 'modelName'), year: pick('modelYear', 'ModelYear', 'year', 'Year', 'registrationYear'),
        engine: pick('engine', 'Engine', 'engineCode', 'motorCode'), power_kw: pick('powerKw', 'PowerKw', 'kw', 'power'), fuel: pick('fuel', 'Fuel', 'fuelType'),
        body: pick('body', 'Body', 'bodyType'), raw: v };
    },
  },
];
function deepGet(o, k) { if (o == null) return undefined; if (k in o) return o[k]; for (const key of Object.keys(o)) if (o[key] && typeof o[key] === 'object') { const r = deepGet(o[key], k); if (r !== undefined) return r; } return undefined; }

async function fetchJSON(url, headers = {}) {
  const hit = cache.get(url);
  if (hit && hit.t > Date.now()) return hit.v;
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`upstream ${r.status}`), { status: r.status, body: text.slice(0, 300) });
    let v; try { v = JSON.parse(text); } catch { throw Object.assign(new Error('upstream ei palauttanut JSONia'), { status: 502, body: text.slice(0, 300) }); }
    cache.set(url, { v, t: Date.now() + CACHE_TTL_MS });
    return v;
  } finally { clearTimeout(to); }
}


/* Vauriohuutokauppa-arkistojen luotaimet (kokeellinen). Haetaan julkinen hakusivu ja katsotaan, esiintyykö VIN tuloksissa.
   Sivustot muuttuvat ja osa estää botit → tulos on "hit" / "none" / "unknown", ei koskaan varma. Lisää/korjaa tähän. */
const PROBES = [
  { name: 'Copart (USA)', url: (v) => `https://www.copart.com/lotSearchResults/?free=true&query=${v}`, none: /no (results|lots) found|0 results/i },
  { name: 'IAAI (USA)', url: (v) => `https://www.iaai.com/Search?Keyword=${v}`, none: /no results|0 results|did not match/i },
  { name: 'bidfax.info', url: (v) => `https://bidfax.info/?do=search&subaction=search&story=${v}`, none: /nothing found|no results|ничего не найдено/i },
  { name: 'poctra.com', url: (v) => `https://poctra.com/search/ap/${v}`, none: /no results|nothing found|0 results/i },
  { name: 'stat.vin', url: (v) => `https://stat.vin/cars/${v}`, none: /not found|no results|404/i },
];
async function probeVin(vin) {
  const out = [];
  await Promise.all(PROBES.map(async (p) => {
    const url = p.url(vin); const key = 'probe:' + url; const hit = cache.get(key);
    if (hit && hit.t > Date.now()) return out.push(hit.v);
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 12000);
    let r = { name: p.name, url, status: 'unknown' };
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.8' }, signal: ctrl.signal, redirect: 'follow' });
      const html = await res.text();
      if (!res.ok) r.note = 'HTTP ' + res.status;
      else if (/captcha|access denied|cf-chl|just a moment|are you a human/i.test(html)) r.note = 'botsuojaus – avaa linkki itse';
      else { const n = (html.toUpperCase().match(new RegExp(vin, 'g')) || []).length; const none = p.none.test(html); r.status = n >= 2 && !none ? 'hit' : 'none'; r.note = n ? 'VIN esiintyy ' + n + ' kertaa' : ''; }
    } catch (e) { r.note = e.name === 'AbortError' ? 'aikakatkaisu' : e.message; }
    clearTimeout(to); cache.set(key, { v: r, t: Date.now() + CACHE_TTL_MS }); out.push(r);
  }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };

const VIN_RE = /^[A-HJ-NPR-Z0-9]{11,17}$/i;
const PLATE_RE = /^[A-ZÅÄÖ]{1,3}-?\d{1,3}$/i;
const SAFE_Q = (q) => encodeURIComponent(String(q || '').slice(0, 60));

async function api(req, res, u) {
  const p = u.pathname;
  if (p === '/api/health') return send(res, 200, { ok: true, cache: cache.size, adapters: REG_ADAPTERS.map(a => a.name), probes: PROBES.map(p => p.name) });
  if (p.startsWith('/api/vin/')) {
    const vin = decodeURIComponent(p.slice(9)).toUpperCase();
    if (!VIN_RE.test(vin)) return send(res, 400, { error: 'virheellinen VIN' });
    return send(res, 200, await fetchJSON(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${vin}?format=json`));
  }
  const make = SAFE_Q(u.searchParams.get('make')), model = SAFE_Q(u.searchParams.get('model')), year = SAFE_Q(u.searchParams.get('modelYear'));
  if (p === '/api/recalls') return send(res, 200, await fetchJSON(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${make}&model=${model}&modelYear=${year}`));
  if (p === '/api/complaints') return send(res, 200, await fetchJSON(`https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${make}&model=${model}&modelYear=${year}`));
  if (p === '/api/ratings') return send(res, 200, await fetchJSON(`https://api.nhtsa.gov/SafetyRatings/modelyear/${year}/make/${make}/model/${model}`));
  if (p.startsWith('/api/ratings/')) { const id = p.slice(13); if (!/^\d{1,8}$/.test(id)) return send(res, 400, { error: 'id' }); return send(res, 200, await fetchJSON(`https://api.nhtsa.gov/SafetyRatings/VehicleId/${id}`)); }
  if (p === '/api/probe') {
    const vin = String(u.searchParams.get('vin') || '').toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return send(res, 400, { error: 'virheellinen VIN' });
    return send(res, 200, await probeVin(vin));
  }
  if (p.startsWith('/api/reg/')) {
    const plate = decodeURIComponent(p.slice(9)).toUpperCase().trim();
    if (!PLATE_RE.test(plate)) return send(res, 400, { ok: false, error: 'virheellinen rekisteritunnus' });
    const errors = [];
    for (const a of REG_ADAPTERS) {
      try {
        const d = await fetchJSON(a.url(plate), a.headers);
        const v = a.map(d);
        if (v) return send(res, 200, { ok: true, vehicle: { ...v, source: a.name } });
        errors.push(`${a.name}: ei tunnistettavaa ajoneuvoa vastauksessa`);
      } catch (e) { errors.push(`${a.name}: ${e.message}${e.status ? ' (' + e.status + ')' : ''}`); }
    }
    return send(res, 200, { ok: false, error: 'Rekisteritunnushaku ei onnistunut: ' + errors.join('; ') + '. Käytä Traficomin Oma asiointia.' });
  }
  send(res, 404, { error: 'ei reittiä' });
}

function serveStatic(req, res, u) {
  let rel = decodeURIComponent(u.pathname); if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || file.includes(path.sep + '.') || rel.includes('server.js')) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

function authorized(req) {
  if (!BASIC_AUTH) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  try { return Buffer.from(h.slice(6), 'base64').toString('utf8') === BASIC_AUTH; } catch { return false; }
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!authorized(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Autorontgen", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Kirjaudu'); }
  try {
    if (u.pathname.startsWith('/api/')) await api(req, res, u); else serveStatic(req, res, u);
  } catch (e) {
    send(res, e.status && e.status >= 400 && e.status < 600 ? 502 : 500, { error: e.message, upstream: e.body });
  }
});
server.listen(PORT, HOST, () => {
  const os = require('os'); const ips = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  console.log(`Autoröntgen käynnissä (Node ${process.version})`);
  console.log(`  tällä koneella:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  lähiverkosta:     http://${ip}:${PORT}`));
  console.log(BASIC_AUTH ? '  salasanasuojaus:  päällä' : '  salasanasuojaus:  POIS – älä avaa internetiin ilman BASIC_AUTH-asetusta');
  console.log('  Ctrl+C lopettaa');
});
