#!/usr/bin/env python3
"""Laskee Traficomin ajoneuvokannan avoimesta datasta vertaisryhmätilaston Autoröntgenille.

Käyttö:
    python3 tools/build_peer_stats.py /polku/TieliikenneAvoinData_x_y.csv [-o data/peer_stats.json] [--min-n 20]

Lähde: https://avoindata.suomi.fi/data/fi/dataset/ajoneuvojen-avoin-data (CC BY 4.0, Traficom).
CSV on ';'-eroteltu, ISO-8859-1 -koodattu, ~5 M riviä (~1 GB). Skripti lukee sen rivi kerrallaan ilman
riippuvuuksia (vain standardikirjasto) ja kirjoittaa kompaktin JSONin:

    { "TESLA|MODEL S|2018": { "n": 412, "km_median": 98000, "km_p25": ..., "km_p75": ..., "km_p90": ...,
                              "km_mean": ..., "mass_median": 2108, "co2_median": 0, "top_color": "Musta",
                              "top_kunta": "Helsinki", "as_of": "2026-03-31" }, ... }

Avain = merkkiSelvakielinen | kaupallinenNimi | ensirekisteröintivuosi (isoilla kirjaimilla). Sovellus normalisoi
NHTSA:n "Model S" → "MODEL S" samalla tavalla. Sarakenimet haetaan otsikkoriviltä kirjainkoosta riippumatta,
joten pienet versioerot aineistossa eivät kaada skriptiä.
"""
import argparse, csv, json, statistics, sys, time
from collections import Counter, defaultdict

COLOR = {'0': 'Musta', '1': 'Ruskea (beige)', '2': 'Punainen', '3': 'Oranssi', '4': 'Keltainen', '5': 'Vihreä', '6': 'Sininen',
         '7': 'Violetti', '8': 'Harmaa', '9': 'Valkoinen', 'X': 'Monivärinen', 'Y': 'Hopea', 'Z': 'Turkoosi'}
FUEL = {'01': 'Bensiini', '02': 'Diesel', '03': 'Polttoöljy', '04': 'Sähkö', '05': 'Vety', '06': 'Kaasu', '07': 'Metanoli', '10': 'Biodiesel',
        '11': 'LPG', '13': 'CNG', '31': 'Moottoripetroli', '33': 'Diesel/CNG', '34': 'Bensiini/CNG', '37': 'Etanoli', '38': 'Bensiini/Etanoli', '39': 'Bensiini/Sähkö', '40': 'Diesel/Sähkö', '42': 'LNG', '43': 'LNG/Diesel', '44': 'H-ryhmän maakaasu', '48': 'Bensiini/LPG', '59': 'Sähkö/Bensiini (plug-in)', '60': 'Sähkö/Diesel (plug-in)'}

KUNTA = {'091': 'Helsinki', '049': 'Espoo', '837': 'Tampere', '092': 'Vantaa', '564': 'Oulu', '853': 'Turku', '179': 'Jyväskylä', '398': 'Lahti',
         '297': 'Kuopio', '609': 'Pori', '286': 'Kouvola', '167': 'Joensuu', '405': 'Lappeenranta', '109': 'Hämeenlinna', '905': 'Vaasa', '743': 'Seinäjoki',
         '698': 'Rovaniemi', '491': 'Mikkeli', '285': 'Kotka', '734': 'Salo', '638': 'Porvoo', '272': 'Kokkola', '106': 'Hyvinkää', '444': 'Lohja', '186': 'Järvenpää',
         '543': 'Nurmijärvi', '684': 'Rauma', '257': 'Kirkkonummi', '858': 'Tuusula', '205': 'Kajaani', '245': 'Kerava', '740': 'Savonlinna', '536': 'Nokia',
         '202': 'Kaarina', '980': 'Ylöjärvi', '211': 'Kangasala', '694': 'Riihimäki', '710': 'Raasepori', '153': 'Imatra', '678': 'Raahe', '790': 'Sastamala',
         '680': 'Raisio', '098': 'Hollola', '418': 'Lempäälä', '749': 'Siilinjärvi', '301': 'Kurikka', '408': 'Lapua', '145': 'Ilmajoki', '005': 'Alajärvi', '010': 'Alavus'}

def find_col(header, *cands):
    low = {h.strip().lower(): i for i, h in enumerate(header)}
    for c in cands:
        if c.lower() in low:
            return low[c.lower()]
    return None

def to_int(s):
    try:
        v = int(float(str(s).replace(',', '.').strip()))
        return v
    except Exception:
        return None

def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    f, c = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return int(round(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)))

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('csv')
    ap.add_argument('-o', '--out', default='data/peer_stats.json')
    ap.add_argument('--min-n', type=int, default=20, help='pienin ryhmäkoko joka julkaistaan (oletus 20)')
    ap.add_argument('--classes', default='M1,M1G', help='ajoneuvoluokat, pilkuilla (oletus M1,M1G = henkilöautot)')
    ap.add_argument('--encoding', default='latin-1')
    ap.add_argument('--as-of', default='', help='aineiston päivämäärä metatiedoksi, esim. 2026-03-31')
    ap.add_argument('--fingerprint', default='', help='pilkuilla eroteltu lista MERKKI|MALLI -avaimia, joista kirjoitetaan yksilötason sormenjälkitiedosto (data/fingerprints.json), esim. "TESLA|MODEL S,FIAT|500E"')
    ap.add_argument('--fingerprint-out', default='data/fingerprints.json')
    a = ap.parse_args()
    classes = {c.strip().upper() for c in a.classes.split(',') if c.strip()}

    fp_keys = {k.strip().upper() for k in a.fingerprint.split(',') if k.strip()}
    fingerprints = defaultdict(list)
    c_kayt = None
    groups = defaultdict(lambda: {'km': [], 'mass': [], 'co2': [], 'color': Counter(), 'kunta': Counter(), 'fuel': Counter()})
    t0 = time.time(); rows = 0; used = 0
    with open(a.csv, encoding=a.encoding, newline='') as f:
        rd = csv.reader(f, delimiter=';')
        header = next(rd)
        c_cls = find_col(header, 'ajoneuvoluokka'); c_make = find_col(header, 'merkkiSelvakielinen', 'merkki')
        c_model = find_col(header, 'kaupallinenNimi', 'mallimerkinta'); c_date = find_col(header, 'ensirekisterointipvm', 'ensirekisterointipaiva')
        c_km = find_col(header, 'matkamittarilukema'); c_mass = find_col(header, 'omamassa'); c_co2 = find_col(header, 'Co2', 'co2')
        c_color = find_col(header, 'vari'); c_kunta = find_col(header, 'kunta'); c_fuel = find_col(header, 'kayttovoima'); c_kayt = find_col(header, 'kayttoonottopvm', 'kayttoonotto')
        missing = [n for n, c in [('ajoneuvoluokka', c_cls), ('merkkiSelvakielinen', c_make), ('kaupallinenNimi', c_model), ('ensirekisterointipvm', c_date), ('matkamittarilukema', c_km)] if c is None]
        if missing:
            sys.exit(f'Puuttuvat sarakkeet: {missing}. Otsikkorivi: {header[:40]}')
        for r in rd:
            rows += 1
            if rows % 500000 == 0:
                print(f'  {rows:,} riviä, {time.time() - t0:.0f} s', file=sys.stderr)
            try:
                if r[c_cls].strip().upper() not in classes:
                    continue
                make = r[c_make].strip().upper(); model = r[c_model].strip().upper()
                year = r[c_date].strip()[:4]
                if not make or not model or not year.isdigit():
                    continue
                km = to_int(r[c_km])
                g = groups[f'{make}|{model}|{year}']
                if km and 500 < km < 2_000_000:
                    g['km'].append(km)
                m = to_int(r[c_mass]) if c_mass is not None else None
                if m and 300 < m < 5000:
                    g['mass'].append(m)
                co2 = to_int(r[c_co2]) if c_co2 is not None else None
                if co2 is not None and 0 <= co2 < 600:
                    g['co2'].append(co2)
                if c_color is not None and r[c_color].strip():
                    g['color'][COLOR.get(r[c_color].strip(), r[c_color].strip())] += 1
                if c_kunta is not None and r[c_kunta].strip():
                    k = r[c_kunta].strip().zfill(3); g['kunta'][KUNTA.get(k, 'kunta ' + k)] += 1
                fuel_name = FUEL.get(r[c_fuel].strip(), r[c_fuel].strip()) if c_fuel is not None and r[c_fuel].strip() else ''
                if fuel_name:
                    g['fuel'][fuel_name] += 1
                mm_key = f'{make}|{model}'
                if mm_key in fp_keys:
                    color_name = COLOR.get(r[c_color].strip(), r[c_color].strip()) if c_color is not None else ''
                    kunta_code = r[c_kunta].strip().zfill(3) if c_kunta is not None and r[c_kunta].strip() else ''
                    fingerprints[mm_key].append([r[c_date].strip()[:10], r[c_kayt].strip() if c_kayt is not None else '', color_name,
                                                 KUNTA.get(kunta_code, 'kunta ' + kunta_code) if kunta_code else '', km, m, co2, fuel_name])
                used += 1
            except IndexError:
                continue

    out = {}
    for key, g in groups.items():
        n = len(g['km'])
        if n < a.min_n:
            continue
        km = sorted(g['km'])
        out[key] = {
            'n': n, 'km_median': pct(km, .5), 'km_p25': pct(km, .25), 'km_p75': pct(km, .75), 'km_p90': pct(km, .9), 'km_mean': int(statistics.fmean(km)),
            'mass_median': int(statistics.median(g['mass'])) if g['mass'] else None,
            'co2_median': int(statistics.median(g['co2'])) if g['co2'] else None,
            'top_color': g['color'].most_common(1)[0][0] if g['color'] else None,
            'top_kunta': g['kunta'].most_common(1)[0][0] if g['kunta'] else None,
            'top_fuel': g['fuel'].most_common(1)[0][0] if g['fuel'] else None,
            'as_of': a.as_of or None,
        }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    if fp_keys:
        for k in fp_keys:
            fingerprints[k].sort(key=lambda x: (x[0], x[4] or 0))
        with open(a.fingerprint_out, 'w', encoding='utf-8') as f:
            json.dump({k: fingerprints[k] for k in fp_keys}, f, ensure_ascii=False, separators=(',', ':'))
        print(f'Sormenjäljet: ' + ', '.join(f'{k}: {len(fingerprints[k])}' for k in fp_keys) + f' → {a.fingerprint_out}')
    print(f'Luettu {rows:,} riviä, käytetty {used:,}, ryhmiä {len(out):,} (min n={a.min_n}) → {a.out} ({time.time() - t0:.0f} s)')

if __name__ == '__main__':
    main()
