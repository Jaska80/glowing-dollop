#!/usr/bin/env python3
"""Kokoaa yhden tiedoston demon (demo/autorontgen-demo.html): CSS ja JS upotettuna, demo-data mukana.
Tiedosto toimii ilman palvelinta ja verkkoa. Käyttö: python3 tools/build_demo.py"""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/style.css').read_text(encoding='utf-8')
js = '\n'.join((root / 'js' / n).read_text(encoding='utf-8') for n in ['vin.js', 'sources.js', 'issues_db.js', 'demo.js', 'app.js'])
body = html[html.index('<body>') + 6: html.index('</body>')]
body = re.sub(r'<script src="[^"]+"></script>\s*', '', body)
out = ('<title>Autoröntgen</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
       '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><rect width=\'100\' height=\'100\' rx=\'20\' fill=\'%2336d1ff\'/><text x=\'50\' y=\'68\' font-size=\'54\' text-anchor=\'middle\' font-family=\'sans-serif\' font-weight=\'700\' fill=\'%2306131a\'>Rx</text></svg>">\n'
       '<style>\n' + css + '\n</style>\n' + body + '\n<script>\n' + js.replace('</script', '<\\/script') + '\n</script>\n')
(root / 'demo').mkdir(exist_ok=True)
(root / 'demo/autorontgen-demo.html').write_text(out, encoding='utf-8')
print('demo/autorontgen-demo.html', len(out.encode()), 'tavua')
