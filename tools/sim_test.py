"""Drive the whole loop in the simulator (fast mode) and report what played where.
usage: python3 tools/sim_test.py <base_url> <cw|ccw> [extra query]"""
import sys, json, time
from playwright.sync_api import sync_playwright
base, d = sys.argv[1], sys.argv[2]
extra = sys.argv[3] if len(sys.argv) > 3 else ''
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    pg.goto(f'{base}/index.html?preview=1&fast=1&rate=4&dir={d}{extra}')
    t0 = time.time(); last = 0
    while time.time() - t0 < 600:
        time.sleep(3)
        log = pg.evaluate('window.__tourLog')
        if any(e['ev'] == 'clip' and e.get('id') == 'closing' for e in log):
            time.sleep(4); break
        if len(log) == last and time.time() - t0 > 60:
            pass
        last = len(log)
        if pg.is_visible('#picker') and not getattr(pg, '_picked', 0):
            pg.click('#picker-grid button[data-w="bison"]'); pg._picked = 1
    # auto-pick an animal when the picker shows, once, to exercise interrupt
    log = pg.evaluate('window.__tourLog')
    pg.screenshot(path=f'/tmp/sim_{d}.png')
    b.close()
json.dump(log, open(f'/tmp/simlog_{d}.json', 'w'), indent=0)
for e in log:
    print(e['ev'], e.get('id') or e.get('at') or e.get('w') or '', '| phase', e['phase'], e['dir'], 'tp', e['tp'], 'mi', e['mi'], 'spur', e['spur'], 'mph', e['mph'])
print('errors:', errs[:10])
