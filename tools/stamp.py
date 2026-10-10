"""Cache busting: stamp a version on the files phones tend to hold on to.
usage: python3 tools/stamp.py [app_dir] [version]
Runs automatically in the GitHub Pages deploy (version = short commit id). Safe to run again."""
import hashlib, os, re, sys
APP = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'app')
ver = sys.argv[2] if len(sys.argv) > 2 else None
if not ver:  # no commit id: use a hash of the code and data
    h = hashlib.sha1()
    for f in ('js/app.js', 'css/app.css', 'data/tour.json'):
        h.update(open(os.path.join(APP, f), 'rb').read())
    ver = h.hexdigest()[:8]
ver = ver[:12]

def edit(rel, fn):
    p = os.path.join(APP, rel); s = open(p, encoding='utf-8').read(); t = fn(s)
    open(p, 'w', encoding='utf-8').write(t)

def page(s):
    for asset in ('css/app.css', 'js/app.js', 'fonts/fonts.css'):
        s = re.sub(re.escape(asset) + r'(\?v=[\w.-]+)?"', f'{asset}?v={ver}"', s)
    if 'name="tour-version"' in s:
        s = re.sub(r'<meta name="tour-version" content="[^"]*">', f'<meta name="tour-version" content="{ver}">', s)
    else:
        s = s.replace('<link rel="manifest"', f'<meta name="tour-version" content="{ver}">\n<link rel="manifest"', 1)
    return s
edit('index.html', page)
edit('sw.js', lambda s: re.sub(r"const SHELL = 'trnp-shell-[^']*';", f"const SHELL = 'trnp-shell-{ver}';", s))
print('stamped', ver)
