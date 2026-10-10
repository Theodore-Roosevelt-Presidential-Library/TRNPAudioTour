#!/usr/bin/env python3
"""Build app/data/tour.json from the script, the route research and the media manifest.

Usage: python3 tools/build_data.py <research_dir> <media_dir>
"""
import json, math, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'data', 'tour.json')
MI = 1609.344

# ---------------------------------------------------------------- script parser
def parse_script(path):
    clips, cur = {}, None
    for raw in open(path, encoding='utf-8'):
        line = raw.rstrip('\n')
        if line.startswith('# CLIP '):
            cid = line[7:].strip()
            cur = {'id': cid, 'lines': [], 'src': ''}
            clips[cid] = cur
            continue
        if cur is None or not line.strip():
            continue
        if line.startswith('# '):
            cur = None
            continue
        m = re.match(r'^(title|kind|stop|src|zone|animal|time):\s*(.*)$', line)
        if m:
            cur[m.group(1)] = m.group(2).strip()
            continue
        m = re.match(r'^(N|W|Q|SFX|TRV):\s*(.*)$', line)
        if not m:
            raise SystemExit(f'Unparsed line in {cur["id"]}: {line}')
        sp, txt = m.group(1), m.group(2).strip()
        entry = {'s': sp}
        if sp == 'Q':
            qm = re.match(r'^(.*?)\s*\{(.*)\}\s*$', txt)
            if not qm:
                raise SystemExit(f'Quote without source in {cur["id"]}: {txt}')
            entry['t'], entry['cite'] = qm.group(1), qm.group(2)
        elif sp in ('SFX', 'TRV'):
            entry['ref'] = txt
        else:
            entry['t'] = txt
        cur['lines'].append(entry)
    return clips

# ---------------------------------------------------------------- geometry
def hav(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def cumul(coords):
    c = [0.0]
    for i in range(1, len(coords)):
        c.append(c[-1] + hav(coords[i - 1], coords[i]))
    return c

def project(coords, cum, lon, lat, lo=0, hi=1e12):
    best = None
    kx = math.cos(math.radians(lat)) * 111320; ky = 110540
    for i in range(1, len(coords)):
        if cum[i] < lo or cum[i - 1] > hi:
            continue
        a, b = coords[i - 1], coords[i]
        ax, ay = (a[0] - lon) * kx, (a[1] - lat) * ky
        bx, by = (b[0] - lon) * kx, (b[1] - lat) * ky
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = 0 if L == 0 else max(0, min(1, -(ax * dx + ay * dy) / L))
        px, py = ax + t * dx, ay + t * dy
        d = math.hypot(px, py)
        if best is None or d < best[0]:
            cross = dx * (-ay) - dy * (-ax)  # >0: point is left of travel direction
            best = (d, cum[i - 1] + t * (cum[i] - cum[i - 1]), 'left' if cross > 0 else 'right')
    return best

def simplify(coords, tol_m=4.0):
    """Douglas-Peucker on a lon/lat polyline (local planar approx)."""
    if len(coords) < 3:
        return coords
    lat0 = coords[0][1]
    kx = math.cos(math.radians(lat0)) * 111320; ky = 110540
    pts = [(c[0] * kx, c[1] * ky) for c in coords]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]; bx, by = pts[j]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
        idx, dmax = -1, 0
        for k in range(i + 1, j):
            px, py = pts[k]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L
            if d > dmax:
                idx, dmax = k, d
        if dmax > tol_m:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [c for c, k in zip(coords, keep) if k]

# ---------------------------------------------------------------- load inputs
def main(RESEARCH, MEDIA):

    clips = parse_script(os.path.join(ROOT, 'script', 'tour-script.md'))
    route = json.load(open(os.path.join(RESEARCH, 'dl', 'osrm_loop.json')))['routes'][0]['geometry']['coordinates']
    route = [[round(x, 6), round(y, 6)] for x, y in route]
    dedup = [route[0]]
    for c in route[1:]:
        if c != dedup[-1]:
            dedup.append(c)
    h = len(dedup) // 2
    route = simplify(dedup[:h + 1], 3.0)[:-1] + simplify(dedup[h:], 3.0)
    cum = cumul(route)
    TOTAL = cum[-1]
    research = {s['id']: s for s in json.load(open(os.path.join(RESEARCH, 'stops.json')))['stops']}
    manifest = {i['file']: i for i in json.load(open(os.path.join(MEDIA, 'manifest.json')))['items']}

    def spur(name):
        c = json.load(open(os.path.join(RESEARCH, 'dl', f'spur_{name}.json')))['routes'][0]['geometry']['coordinates']
        c = [[round(x, 6), round(y, 6)] for x, y in c]
        return {'coords': c, 'cum': [round(v / MI, 4) for v in cumul(c)]}

    # loop junction splits stem/loop
    J = research['loop-junction']
    _, j_out, _ = project(route, cum, J['lon'], J['lat'], 0, 8 * MI)
    _, j_in, _ = project(route, cum, J['lon'], J['lat'], 25 * MI, TOTAL)

    def point_at(m):
        for i in range(1, len(route)):
            if cum[i] >= m:
                t = (m - cum[i - 1]) / ((cum[i] - cum[i - 1]) or 1)
                a, b = route[i - 1], route[i]
                return [round(a[0] + t * (b[0] - a[0]), 6), round(a[1] + t * (b[1] - a[1]), 6)]
        return route[-1]

    # ---------------------------------------------------------------- stops
    STOPS = [
        # id, kind, approach clip, parked clip, photos, extra
        ('visitor-center', 'start', None, 'vc-cabin', ['visitor-center', 'maltese-cross-cabin-summer', 'maltese-cross-cabin-winter', 'tr-1885-buckskin-portrait'], {'visual': 'timeline'}),
        ('medora-overlook', 'driveby', 'medora-overlook', None, ['medora-from-park', 'marquis-de-mores-portrait', 'medora-von-hoffman-marquise-portrait', 'de-mores-packing-plant-smokestack'], {}),
        ('johnsons-plateau', 'driveby', 'johnsons-plateau', None, ['prairie-dog-black-tailed', 'prairie-dog-town-roadside'], {}),
        ('skyline-vista', 'pulloff', 'skyline-vista', 'skyline-parked', ['little-missouri-river-1', 'tr-1885-buckskin-full-length'], {}),
        ('river-overlook-cottonwood', 'driveby', 'river-cottonwoods', None, ['cottonwood-campground-river-view', 'little-missouri-river-2', 'porcupine'], {'name': 'Little Missouri River'}),
        ('loop-junction', 'nav', 'loop-junction', None, ['scenic-loop-drive-scenery'], {'name': 'Loop junction', 'visual': 'choose'}),
        ('prairie-dog-town-junction', 'pulloff', 'pd-junction', 'pd-junction-parked', ['prairie-dog-alert', 'prairie-dog-town-roadside', 'american-badger', 'coyote-calling'], {'name': 'Prairie Dog Town', 'visual': 'soundboard'}),
        ('peaceful-valley-ranch', 'pulloff', 'peaceful-valley', None, ['peaceful-valley-ranch-house', 'peaceful-valley-ranch-1928-camp-wagon', 'peaceful-valley-ranch-complex'], {}),
        ('beef-corral-bottom', 'driveby', 'beef-corral', None, ['pronghorn-1', 'pronghorn-2', 'prairie-dog-black-tailed'], {'name': 'Beef Corral Bottom'}),
        ('wind-canyon', 'pulloff', 'wind-canyon', 'wind-canyon-parked', ['wind-canyon-1', 'little-missouri-from-wind-canyon', 'wind-canyon-sunset', 'elk-bull'], {}),
        ('north-junction-east-river-road', 'nav', 'north-junction', None, ['scenic-loop-drive-scenery'], {'name': 'Stay on the paved loop'}),
        ('upper-jones-creek-trailhead', 'driveby', 'jones-creek-ccc', None, ['old-east-entrance-station-historic'], {'name': 'Jones Creek'}),
        ('boicourt-overlook', 'pulloff', 'boicourt', 'boicourt-parked', ['boicourt-overlook-winter', 'wild-horses-south-unit', 'wild-horses-greys'], {}),
        ('buck-hill-turn', 'spurturn', 'buck-hill-invite', None, ['buck-hill-view'], {'name': 'Buck Hill turnoff', 'spur': 'buck'}),
        ('buck-hill', 'spurend', None, 'buck-hill-top', ['buck-hill-view', 'elk-fall-harem'], {'name': 'Buck Hill', 'spur': 'buck'}),
        ('coal-vein-turn', 'spurturn', 'coal-vein-invite', None, ['coal-vein-subsidence', 'clinker-buttes'], {'name': 'Coal Vein turnoff', 'spur': 'coal'}),
        ('coal-vein-trail', 'spurend', None, 'coal-vein-trail', ['coal-vein-subsidence', 'scoria-porcelanite', 'clinker-buttes'], {'name': 'Coal Vein Trail', 'spur': 'coal', 'visual': 'strata'}),
        ('old-east-entrance', 'pulloff', 'old-east-entrance', None, ['old-east-entrance-station-front', 'old-east-entrance-station-historic', 'american-badger'], {}),
        ('badlands-overlook', 'pulloff', 'badlands-overlook', None, ['badlands-overlook-buttes', 'petrified-wood-hoodoo'], {'name': 'Badlands Overlook', 'visual': 'strata'}),
        ('ridgeline-nature-trail', 'driveby', 'ridgeline', None, ['ridgeline-trail-elk'], {}),
        ('scoria-point', 'pulloff', 'scoria-point', None, ['scoria-red-rock', 'clinker-buttes', 'scenic-loop-drive-bull-bison'], {'name': 'Scoria Point Overlook', 'visual': 'strata'}),
    ]

    ONFOOT = {
        'visitor-center': 'Flush restrooms, water, museum and park film. The Maltese Cross Cabin is a short walk behind the building.',
        'skyline-vista': 'Flat, paved, wheelchair-accessible trail to the overlook, about 0.1–0.2 mi. Benches and exhibits. Cell signal is usually available.',
        'prairie-dog-town-junction': 'Paved sidewalk and exhibits. Stay on the pavement and do not feed the prairie dogs.',
        'peaceful-valley-ranch': 'Restroom and picnic table. Historic ranch buildings. Guided trail rides are no longer offered.',
        'wind-canyon': 'About 0.4-mile loop, ~20 minutes, dirt and gravel with stairs. The sidewalk at the start is accessible.',
        'boicourt-overlook': 'Overlook sidewalk right off the road. A paved, accessible trail continues out along the ridge (about 0.2–0.3 mi). Cell signal is usually available.',
        'buck-hill': 'Short, steep path (0.1–0.2 mi) with stairs to the summit. Sidewalk and exhibit are accessible. Cell signal is usually available.',
        'coal-vein-trail': '0.6–0.8-mile loop with numbered posts and stairs, 30–45 minutes. Stay left and follow the posts. Clay is slick when wet.',
        'old-east-entrance': 'Walk about 0.4 mi each way through a prairie dog town to the CCC stone station.',
        'badlands-overlook': 'Sidewalk and exhibit, wheelchair accessible.',
        'scoria-point': 'Sidewalk and exhibit, wheelchair accessible.',
    }

    QUIZ = {
        'visitor-center': [{'q': 'What did Medora locals call the Maltese cross brand?', 'a': ['The "maltee" cross', 'The Medora cross', 'The Chimney Butte brand'], 'c': 0,
                            'why': 'They assumed "maltese" had to be plural. Roosevelt found that funny enough to put in his autobiography.'}],
        'prairie-dog-town-junction': [{'q': 'What is a prairie dog family group called?', 'a': ['A pack', 'A coterie', 'A colony'], 'c': 1,
                                       'why': 'Coteries live together inside the larger town — and greet each other with a little "kiss."'},
                                      {'q': 'In 1901, one prairie dog town was estimated to hold how many prairie dogs?', 'a': ['400 thousand', '4 million', '400 million'], 'c': 2,
                                       'why': 'It covered about 25,000 square miles (NPS). Poisoning campaigns later wiped most of them out.'}],
        'wind-canyon': [{'q': 'Which bird nests in the hollows of Wind Canyon?', 'a': ['Golden eagle', 'Great horned owl', 'Western meadowlark'], 'c': 1,
                         'why': 'The wind-carved sandstone walls are full of hollows that great horned owls use for nests.'}],
        'boicourt-overlook': [{'q': 'About how many wild horses live in the South Unit?', 'a': ['About 20', 'About 200', 'About 2,000'], 'c': 1,
                               'why': 'NPS counted 198 in 2026. The park manages them as a cultural resource.'}],
        'buck-hill': [{'q': 'The ripples in the rock at the top of Buck Hill tell you it used to be…', 'a': ['A sand dune', 'The bottom of a stream', 'A lake shore'], 'c': 1,
                       'why': 'The highest point you can drive to was once an ancient streambed.'}],
        'coal-vein-trail': [{'q': 'How long did the Coal Vein fire burn?', 'a': ['26 days', '26 months', '26 years'], 'c': 2,
                             'why': 'It started in 1951, probably from lightning, and burned until 1977.'},
                            {'q': 'What do locals call the red, baked rock made by coal fires?', 'a': ['Scoria', 'Lava', 'Flint'], 'c': 0,
                             'why': 'Geologists call it clinker. True scoria is volcanic — the local name just stuck.'}],
        'old-east-entrance': [{'q': 'Who built the Old East Entrance Station?', 'a': ['The U.S. Army', 'The Civilian Conservation Corps', 'Roosevelt\'s ranch hands'], 'c': 1,
                               'why': 'CCC enrollees built it in 1938 from hand-shaped local sandstone.'}],
        'badlands-overlook': [{'q': 'Which way did the Little Missouri flow before the glaciers?', 'a': ['North, toward Hudson Bay', 'West, toward the Rockies', 'It didn\'t exist yet'], 'c': 0,
                               'why': 'Ice sheets blocked it and pushed it east. The steeper course is what carved the badlands.'}],
        'scoria-point': [{'q': 'Why do red caps sit on top of so many buttes?', 'a': ['Iron-rich lava', 'Coal-fire baked rock is harder than the rock below', 'Red soil washed down from above'], 'c': 1,
                          'why': 'Clinker is a natural brick. It resists erosion and protects the softer layers under it like a helmet.'}],
        'skyline-vista': [{'q': 'How many beds were in Roosevelt\'s room his first night in the Badlands?', 'a': ['One', 'Four', 'Fourteen'], 'c': 2,
                           'why': 'The Pyramid Park Hotel was, in his word, "ramshackle."'}],
    }

    def photo(name):
        f = f'photos/{name}.jpg'
        if f not in manifest:
            raise SystemExit('missing photo ' + f)
        return name

    stops = []
    for sid, kind, appr, parked, photos, extra in STOPS:
        r = research[sid]
        st = {'id': sid, 'name': extra.get('name', r['name'].split(' (')[0]), 'kind': kind, 'lat': r['lat'], 'lon': r['lon'],
              'approach': appr, 'parked': parked, 'photos': [photo(p) for p in photos],
              'restroom': bool(r.get('restrooms')), 'onfoot': ONFOOT.get(sid), 'quiz': QUIZ.get(sid, [])}
        for k in ('visual', 'spur'):
            if k in extra:
                st[k] = extra[k]
        if kind == 'spurend':
            st['mi'] = None
        else:
            if sid == 'visitor-center':
                d, m, side = 0, 0.0, 'right'
            elif sid == 'loop-junction':
                d, m, side = 0, j_out, None
            else:
                # stem stops are measured on the outbound stem; loop stops inside the loop range
                r_m = r['miles_from_visitor_center_clockwise'] * MI
                d, m, side = project(route, cum, r['lon'], r['lat'], max(0, r_m - 1.2 * MI), r_m + 1.2 * MI)
            st['mi'] = round(m / MI, 3)
            st['offset_m'] = round(d)
            st['side_cw'] = side if d >= 15 else None
            st['road'] = point_at(m)
            st['on'] = 'stem' if m <= j_out + 1 else 'loop'
        stops.append(st)

    # ---------------------------------------------------------------- photos & sounds credits
    photos = {}
    for st in stops:
        for p in st['photos']:
            photos[p] = None
    for c in clips.values():
        pass
    IMG_STORY = {
        'story-bison-hunt': ['tr-1885-buckskin-portrait', 'bison-prairie-stroll'],
        'story-feb-1884': ['tr-1885-buckskin-portrait'],
        'story-elkhorn': ['elkhorn-ranch-grand-view', 'elkhorn-ranch-winter-buttes'],
        'story-boat-thieves': ['little-missouri-river-2', 'elkhorn-ranch-winter-buttes'],
        'story-horses': ['wild-horses-greys', 'wild-horses-south-unit', 'horses-near-medora-highsmith'],
        'story-bison-comeback': ['bison-crossing-river', 'bison-prairie-stroll'],
        'story-park-founding': ['scenic-loop-drive-scenery', 'visitor-center'],
        'story-elk': ['elk-fall-harem', 'elk-bull'],
        'story-meadowlark': ['western-meadowlark'],
        'story-lonely-plains': ['badlands-overlook-buttes'],
        'story-stockman': ['tr-1885-buckskin-full-length'],
        'story-his-voice': ['tr-1885-buckskin-portrait'],
        'story-night-sky': ['wind-canyon-sunset'],
        'rebuilt-road': ['scenic-loop-drive-scenery', 'scenic-loop-drive-bull-bison'],
        'closing': ['tr-1885-buckskin-portrait', 'chateau-de-mores'],
        'welcome': ['visitor-center', 'scenic-loop-drive-scenery'],
        'wild-bison': ['bison-prairie-stroll', 'scenic-loop-drive-bull-bison'],
        'wild-horses': ['wild-horses-greys', 'wild-horses-south-unit'],
        'wild-prairie-dogs': ['prairie-dog-alert', 'prairie-dog-black-tailed'],
        'wild-elk': ['elk-bull', 'elk-fall-harem'],
        'wild-pronghorn': ['pronghorn-1', 'pronghorn-2'],
        'wild-deer': ['mule-deer', 'mule-deer-buck-velvet', 'white-tailed-deer-buck-ice'],
        'wild-coyote': ['coyote-calling'],
        'wild-birds': ['golden-eagle-nest', 'wild-turkey', 'sharp-tailed-grouse'],
        'wild-snake': ['prairie-rattlesnake-coiled'],
        'wild-porcupine': ['porcupine'],
        'wild-badger': ['american-badger'],
        'wild-traffic': ['scenic-loop-drive-bull-bison'],
    }
    VISUAL_STORY = {'story-bison-comeback': 'bisonchart', 'story-feb-1884': None, 'wild-bison': 'thumb', 'wild-horses': 'thumb', 'wild-elk': 'thumb'}
    for cid, imgs in IMG_STORY.items():
        if cid not in clips:
            raise SystemExit('IMG_STORY refers to unknown clip ' + cid)
        clips[cid]['images'] = [photo(p) for p in imgs]
        for p in imgs:
            photos[p] = None
    for cid, v in VISUAL_STORY.items():
        if v:
            clips[cid]['visual'] = v
    for st in stops:
        for key in ('approach', 'parked'):
            cid = st[key]
            if cid:
                if cid not in clips:
                    raise SystemExit(f'stop {st["id"]} refers to unknown clip {cid}')
                clips[cid].setdefault('images', st['photos'])
    for p in list(photos):
        it = manifest[f'photos/{p}.jpg']
        photos[p] = {'title': it.get('title'), 'credit': it.get('attribution') or it.get('author'), 'license': it.get('license'), 'url': it.get('source_url'),
                     'w': it.get('width'), 'h': it.get('height')}

    sounds = {}
    for f, it in manifest.items():
        if (it.get('type') in ('sound', 'animal_sound', 'audio') or f.startswith('sounds/')) and it.get('status') != 'verify':
            sid = os.path.splitext(os.path.basename(f))[0]
            sounds[sid] = {'file': 'media/' + f, 'title': it.get('title'), 'credit': it.get('attribution') or it.get('author'), 'license': it.get('license'),
                           'url': it.get('source_url'), 'status': it.get('status')}
    for c in clips.values():
        for ln in c['lines']:
            if ln['s'] == 'SFX' and ln['ref'] not in sounds:
                raise SystemExit(f'Unknown SFX {ln["ref"]} in {c["id"]}')

    SOUNDBOARD = [('bison', 'Bison', 'bison-bellow'), ('elk', 'Elk bugle', 'elk-bugle'), ('coyote', 'Coyotes', 'coyote-chorus'),
                  ('pd', 'Prairie dog', 'prairie-dog-yip'), ('meadowlark', 'Meadowlark', 'western-meadowlark-song'), ('turkey', 'Wild turkey', 'wild-turkey-gobble'),
                  ('grouse', 'Sharp-tailed grouse', 'sharp-tailed-grouse-call'), ('eagle', 'Golden eagle', 'golden-eagle-call'), ('horse', 'Horse', 'horse-whinny')]

    WILDLIFE = [('bison', 'Bison', 'wild-bison'), ('horses', 'Wild horses', 'wild-horses'), ('prairie-dogs', 'Prairie dogs', 'wild-prairie-dogs'),
                ('elk', 'Elk', 'wild-elk'), ('pronghorn', 'Pronghorn', 'wild-pronghorn'), ('deer', 'Deer', 'wild-deer'), ('coyote', 'Coyote', 'wild-coyote'),
                ('birds', 'Eagle / turkey', 'wild-birds'), ('snake', 'Snake', 'wild-snake'), ('porcupine', 'Porcupine', 'wild-porcupine'),
                ('badger', 'Badger', 'wild-badger'), ('traffic', 'Just traffic', 'wild-traffic')]

    STORIES = ['story-bison-hunt', 'story-feb-1884', 'story-stockman', 'story-elkhorn', 'story-horses', 'story-bison-comeback', 'story-boat-thieves',
               'story-park-founding', 'story-meadowlark', 'story-elk', 'story-lonely-plains', 'story-his-voice', 'story-night-sky']

    # speed limits along the clockwise polyline (miles). 25 mph is the NPS default; 35 mph segments are from OSM tags (verify on site).
    north_j = next(s for s in stops if s['id'] == 'north-junction-east-river-road')['mi']
    pdj = next(s for s in stops if s['id'] == 'prairie-dog-town-junction')['mi']
    speed = [
        {'from': 0, 'to': 0.12, 'mph': 25, 'verified': False, 'note': 'entrance station area'},
        {'from': 0.12, 'to': north_j, 'mph': 35, 'verified': False, 'note': 'OSM maxspeed tag; NPS default is 25 unless posted'},
        {'from': north_j, 'to': pdj, 'mph': 25, 'verified': True, 'note': 'NPS default 25 mph'},
        {'from': pdj, 'to': round(TOTAL / MI, 3), 'mph': 35, 'verified': False, 'note': 'OSM maxspeed tag'},
    ]
    old_east = next(s for s in stops if s['id'] == 'old-east-entrance')['mi']
    zones = {'rebuilt-section': {'from': old_east + 0.2, 'to': pdj - 0.3}}

    # Roosevelt's own recorded voice (1912 Edison cylinder, public domain). Words confirmed against the audio.
    trv = {'tr-spend-and-be-spent': {'file': 'media/tr/tr-spend-and-be-spent.mp3',
           'caption': 'In the long fight for righteousness the watchword for all of us is spend and be spent.',
           'credit': 'Theodore Roosevelt, "The Right of the People to Rule," Edison recording, 1912. Public domain. Library of Congress / Internet Archive.',
           'dur': 6.6}}
    for c in clips.values():
        for ln in c['lines']:
            if ln['s'] == 'TRV' and ln['ref'] not in trv:
                raise SystemExit('Unknown TRV ' + ln['ref'])

    # finished audio (made by tools/assemble.py) is picked up automatically
    APP = os.path.join(ROOT, 'app')
    for cid, c in clips.items():
        tf = os.path.join(APP, 'audio', cid + '.json')
        if os.path.exists(tf):
            c['audio'] = json.load(open(tf))

    tour = {
        'version': 1,
        'trv': trv,
        'title': 'Scenic Loop with Nora & Wes',
        'route': {'coords': route, 'cum': [round(v / MI, 4) for v in cum], 'total': round(TOTAL / MI, 3),
                  'junctionOut': round(j_out / MI, 3), 'junctionIn': round(j_in / MI, 3)},
        'spurs': {'buck': {**spur('buck'), 'mph': 15, 'turn': 'buck-hill-turn', 'end': 'buck-hill'},
                  'coal': {**spur('coal'), 'mph': 25, 'turn': 'coal-vein-turn', 'end': 'coal-vein-trail'}},
        'speed': speed,
        'zones': zones,
        'stops': stops,
        'stories': STORIES,
        'wildlife': [{'id': a, 'label': l, 'clip': c} for a, l, c in WILDLIFE],
        'soundboard': [{'id': a, 'label': l, 'sound': s} for a, l, s in SOUNDBOARD],
        'clips': clips,
        'photos': photos,
        'sounds': sounds,
        'hosts': {'N': {'name': 'Nora', 'voice': 'Resonance'}, 'W': {'name': 'Wes', 'voice': 'Keen'}},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(tour, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
    print('clips', len(clips), 'stops', len(stops), 'route pts', len(route), 'total mi', round(TOTAL / MI, 2), 'junction', round(j_out / MI, 2), round(j_in / MI, 2))
    for s in stops:
        print(f"  {s['id']:32s} {s.get('mi')!s:>7} {s.get('side_cw')!s:6} off={s.get('offset_m')} {s.get('on')}")
    words = sum(len(l.get('t', '').split()) for c in clips.values() for l in c['lines'])
    print('spoken words', words)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
