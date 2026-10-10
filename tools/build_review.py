#!/usr/bin/env python3
"""Render the script-review page from app/data/tour.json.
Writes app/script.html (standalone) and, if a second path is given, an artifact fragment (no html/head/body)."""
import json, os, sys, html
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, 'app', 'data', 'tour.json')))
esc = html.escape
C = T['clips']

def fmt_line(l):
    s = l['s']
    if s == 'SFX':
        snd = T['sounds'][l['ref']]
        return f'<li class="ln sfx"><span class="who">Sound</span><p>{esc(snd["title"] or l["ref"])} <small>({esc(snd["credit"] or "")})</small></p></li>'
    if s == 'TRV':
        v = T['trv'][l['ref']]
        return f'<li class="ln trv"><span class="who">T.R.</span><p>“{esc(v["caption"])}” <small>His own voice, Edison recording, 1912</small></p></li>'
    if s == 'Q':
        return f'<li class="ln q"><span class="who">Quote</span><p><q>{esc(l["t"])}</q> <cite>{esc(l["cite"])}</cite></p></li>'
    name = T['hosts'][s]['name']
    return f'<li class="ln {s}"><span class="who">{name}</span><p>{esc(l["t"])}</p></li>'

def shot_html(c, i):
    """The photo that comes up on this line, shown as a small frame in the script."""
    at = c.get('imageAt') or []
    if i not in at:
        return ''
    name = c['images'][at.index(i)]
    ph = T['photos'].get(name) or {}
    return f'<li class="shot"><img loading="lazy" src="media/photos/{name}.jpg" alt=""><span>{esc(ph.get("title") or name)}</span></li>'

def clip_html(cid, where=None):
    c = C[cid]
    dur = c.get('audio', {}).get('dur')
    play = f'<button class="play" data-src="audio/{cid}.mp3" aria-label="Play {esc(c["title"])}"><span>Play</span> <b>{int(dur // 60)}:{int(dur % 60):02d}</b></button>' if dur else ''
    meta = f'<p class="where">{esc(where)}</p>' if where else ''
    quotes = sum(1 for l in c['lines'] if l['s'] == 'Q')
    q = f'<span class="tag">{quotes} TR quote{"s" if quotes > 1 else ""} for Joe</span>' if quotes else ''
    return f'''<article class="clip" id="{cid}">
  <header><div>{meta}<h3>{esc(c["title"])}</h3></div>{play}</header>
  <ol class="lines">{"".join(shot_html(c, i) + fmt_line(l) for i, l in enumerate(c["lines"]))}</ol>
  <details><summary>Sources {q}</summary><p>{esc(c.get("src", ""))}</p><p class="cid">Clip id: {cid}</p></details>
</article>'''

# ---- stops in clockwise road order
stops = [s for s in T['stops']]
def stop_label(s, kind):
    mi = s.get('mi')
    side = s.get('side_cw')
    bits = []
    if mi is not None:
        if s['on'] == 'stem':
            bits.append(f'Mile {mi:.1f} from the visitor center')
        else:
            ccw = T['route']['junctionOut'] + (T['route']['junctionIn'] - mi)
            bits.append(f'Mile {mi:.1f} clockwise, {ccw:.1f} counter-clockwise')
    else:
        bits.append('End of side road')
    bits.append({'pulloff': 'Pull-off', 'driveby': 'Plays as you pass', 'nav': 'Navigation', 'spurturn': 'Side-road turn', 'spurend': 'Side road', 'start': 'Start'}[s['kind']])
    if kind == 'parked':
        bits.append('Plays when you park')
    return '. '.join(bits) + '.'

order = sorted([s for s in stops if s['mi'] is not None], key=lambda s: s['mi'])
spur_ends = {s['spur']: s for s in stops if s['kind'] == 'spurend'}
stop_sections = []
for s in order:
    for key in ('approach', 'parked'):
        if s.get(key):
            stop_sections.append(clip_html(s[key], f'{s["name"]}. ' + stop_label(s, key)))
    if s['kind'] == 'spurturn':
        e = spur_ends[s['spur']]
        stop_sections.append(clip_html(e['parked'], f'{e["name"]}. ' + stop_label(e, 'parked')))
stop_sections.append(clip_html('rebuilt-road', 'Plays once on the rebuilt south stretch, either direction'))
stop_sections.append(clip_html('closing', 'Plays on the way back to Medora'))

stories = [clip_html(cid, 'Fills an open stretch of road' + (' after sunset' if C[cid].get('time') == 'evening' else '')) for cid in T['stories']]
wild = [clip_html(w['clip'], f'When you pick “{w["label"]}” after slowing down') for w in T['wildlife']]
system = [clip_html(cid) for cid in C if C[cid].get('kind') == 'system']

words = sum(len(l.get('t', '').split()) for c in C.values() for l in c['lines'])
mins = sum(c.get('audio', {}).get('dur', 0) for c in C.values()) / 60
nq = sum(1 for c in C.values() for l in c['lines'] if l['s'] == 'Q')

CHECKS = [
    ('Ridgeline Nature Trail status', 'NPS’s South Unit page (updated May 2026) still says the trail is “currently inaccessible due to road collapse.” No closure is in the NPS alerts feed, and the script tells drivers to check the trailhead sign. Call the park (701-623-4466) to confirm.'),
    ('35 mph speed limits', 'NPS says 25 mph unless posted. The 35 mph limits on the stem and the west side come from OpenStreetMap only. Confirm on the next drive; one line in app/data/tour.json changes them.'),
    ('Ranch-era details from Hagedorn', 'The bison-hunt victory dance, the $100, and Ferris’s “never saw any one so enthused” come from Hagedorn’s 1921 book, based on Ferris’s recollection. They are marked medium confidence.'),
    ('Wild horse origins', 'The script says the horses descend from ranch horses and horses from tribes in the area, fenced in when the park boundary went up in the 1950s (AP, 2024). Count of “about 200” is from NPS’s April 2026 update (198).'),
    ('The 1884 diary on display', 'The Feb. 14, 1884 story and the closing both say the diary is on display at the Library. Confirm the loan is current.'),
    ('Pronunciations', 'Listen to “de Morès” (Medora Overlook), “coteries” (Johnson’s Plateau) and “porcupette” (Little Missouri). Any line can be re-voiced alone.'),
    ('Joe Wiegand quote session', f'{nq} Roosevelt quotations are read by Nora for now. Each one is tagged below; Joe’s recordings drop in without touching the rest.'),
    ('Library sightline at Skyline Vista', 'The on-foot clip tells people to look south toward Medora, then a little right of town, to find the Library on its butte. Confirm that direction standing at the overlook.'),
    ('Historical photos', 'Seventeen Houghton Library (Harvard) photos came from the DAM. Two are staged 1886 re-creations of the boat-thief capture and are captioned that way. Confirm the Harvard terms cover a free public web app.'),
    ('Artlist license', 'Confirm the plan covers AI voice-overs in a free public web app.'),
    ('Animal sounds', 'Bison, elk, coyote and prairie dog recordings are public-domain NPS recordings from other parks (Yellowstone, Wind Cave and others). The horse sounds are domestic horses. No free pronghorn recording exists. Artlist’s Yellowstone Sound Library has better bison takes if you want to swap them in.'),
    ('NPS’s own audio tour', 'NPS has an 11-stop Scenic Loop tour in the NPS App. This one is longer and story-driven; a heads-up to the park before launch is a good idea.'),
]

body = f'''
<header class="top">
  <p class="kicker">Draft for review</p>
  <h1>Scenic Loop script</h1>
  <p class="lede">Every word Nora and Wes say on the drive, in road order, with the recorded audio and the source behind each fact. Roosevelt quotations are verbatim from his books and diary.</p>
  <dl class="facts">
    <div><dt>Recorded audio</dt><dd>{mins:.0f} min</dd></div>
    <div><dt>Spoken words</dt><dd>{words:,}</dd></div>
    <div><dt>Clips</dt><dd>{len(C)}</dd></div>
    <div><dt>TR quotations</dt><dd>{nq}</dd></div>
  </dl>
  <p class="actions"><a class="btn" href="index.html#preview">Preview the drive</a> <span>Plays the whole tour on a simulated drive. Use the menu to pick a direction and speed.</span></p>
</header>

<nav class="toc" aria-label="Sections">
  <a href="#checks">Before launch</a><a href="#stops">Stops</a><a href="#stories">Stories</a><a href="#wildlife">Wildlife</a><a href="#system">Prompts</a>
</nav>

<section id="checks" class="checks">
  <h2>Check before launch</h2>
  <ol>{"".join(f"<li><b>{esc(a)}.</b> {esc(b)}</li>" for a, b in CHECKS)}</ol>
</section>

<section id="stops"><h2>Stops, in road order</h2><p class="note">Mileage is clockwise from the visitor center (Peaceful Valley first). Counter-clockwise drivers hear the same clips in reverse order; nothing in the script assumes a direction.</p>{"".join(stop_sections)}</section>
<section id="stories"><h2>Stories</h2><p class="note">These play in quiet stretches, in this order, only when there is time to finish before the next stop.</p>{"".join(stories)}</section>
<section id="wildlife"><h2>Wildlife</h2><p class="note">When the car slows to a crawl away from a pull-off, the screen asks what you’re seeing. Picking an animal plays its clip and adds it to the wildlife count.</p>{"".join(wild)}</section>
<section id="system"><h2>Prompts</h2><p class="note">Speeding nudges (up to three per drive, five minutes apart), traffic, side roads, GPS and off-route help.</p>{"".join(system)}</section>
<footer class="foot"><p>Voices: Nora (Artlist “Resonance”) and Wes (Artlist “Keen”). Source keys: AUTO = <i>An Autobiography</i> (1913); HTR = <i>Hunting Trips of a Ranchman</i> (1885); RL = <i>Ranch Life and the Hunting-Trail</i> (1888); OP = <i>Outdoor Pastimes of an American Hunter</i>; HAG = Hagedorn, <i>Roosevelt in the Bad Lands</i> (1921); TRC = Theodore Roosevelt Center. Full fact sheet: research/facts.md in the repo.</p></footer>
'''

CSS = '''
/* Layout: a single reading column; each clip is a script page with a play control. */
:root{
  --paper:#F3F1EA; --ink:#25282A; --muted:#5E625F; --rule:#D8D3C5; --chip:#E6E1D3;
  --clinker:#B4532F; --butte:#3E5873; --juniper:#1B4532; --card:#FBFAF6;
  --display:'Oswald','Arial Narrow',sans-serif; --serif:'Source Serif 4',Georgia,serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#202325;--ink:#E3DFD3;--muted:#A9A496;--rule:#3A3F43;--chip:#2F3336;--clinker:#E7805D;--butte:#99ADC5;--juniper:#87BB41;--card:#26292B;color-scheme:dark}}
:root[data-theme="dark"]{--paper:#202325;--ink:#E3DFD3;--muted:#A9A496;--rule:#3A3F43;--chip:#2F3336;--clinker:#E7805D;--butte:#99ADC5;--juniper:#87BB41;--card:#26292B;color-scheme:dark}
body{background:var(--paper);color:var(--ink);font-family:var(--serif);font-size:17px;line-height:1.55;margin:0}
.wrap{max-width:780px;margin:0 auto;padding-inline:20px;padding-block:32px 64px}
h1,h2,h3{font-family:var(--display);font-weight:500;text-wrap:balance;line-height:1.1}
h1{font-size:clamp(2.4rem,7vw,3.6rem);margin:.1em 0 .3em;font-weight:600}
h2{font-size:1.9rem;margin:2.4rem 0 .4rem;padding-top:1rem;border-top:3px solid var(--ink)}
h3{font-size:1.35rem;margin:0}
.kicker{font-family:var(--display);color:var(--muted);margin:0}
.lede{font-size:1.15rem;max-width:36em}
.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:1.2rem 0}
.facts div{border-top:1px solid var(--rule);padding-top:6px}
.facts dt{font-size:.85rem;color:var(--muted)} .facts dd{margin:0;font-family:var(--display);font-size:1.8rem;font-variant-numeric:tabular-nums}
.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;color:var(--muted)}
.btn{font-family:var(--display);font-size:1.1rem;background:var(--juniper);color:var(--paper);text-decoration:none;padding:.6em 1.1em;border-radius:6px}
.toc{position:sticky;top:env(safe-area-inset-top,0px);z-index:2;background:var(--paper);display:flex;gap:18px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--rule);font-family:var(--display)}
.toc a{color:var(--ink);text-decoration:none} .toc a:hover{color:var(--clinker)}
.checks ol{padding-left:1.3em} .checks li{margin-bottom:.6em}
.note{color:var(--muted);margin-top:0}
.clip{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:16px 18px;margin:14px 0}
.clip header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.clip header>div{min-width:0}
.where{margin:0 0 2px;font-size:.88rem;color:var(--muted)}
.play{flex:none;font-family:var(--display);font-size:1rem;border:2px solid var(--ink);background:transparent;color:var(--ink);border-radius:20px;padding:.3em .9em;cursor:pointer;min-height:40px}
.play b{font-weight:400;font-variant-numeric:tabular-nums;color:var(--muted)}
.play.on{background:var(--ink);color:var(--paper)} .play.on b{color:var(--paper)}
.lines{list-style:none;padding:0;margin:12px 0 6px;display:grid;gap:8px}
.ln{display:grid;grid-template-columns:4.6rem minmax(0,1fr);gap:10px;align-items:baseline}
.ln p{margin:0}
.shot{display:flex;gap:10px;align-items:center;margin:6px 0 0 4.6rem;font-size:.82rem;color:var(--muted)}
.shot img{width:96px;height:64px;object-fit:cover;border-radius:4px;flex:none;background:#0002}
@media (max-width:520px){.shot{margin-left:0}}
.who{font-family:var(--display);font-size:.9rem;color:var(--muted)}
.ln.N .who{color:var(--clinker)} .ln.W .who{color:var(--butte)}
.ln.q p{font-style:italic} .ln.q q{quotes:"“" "”"}
.ln.q cite{display:block;font-style:normal;font-size:.85rem;color:var(--muted)}
.ln.sfx p,.ln.trv p{color:var(--muted)} .ln small{font-size:.82rem}
.tag{font-family:var(--display);font-size:.8rem;background:var(--chip);border-radius:10px;padding:.1em .6em;margin-left:6px}
details{font-size:.9rem;color:var(--muted)} summary{cursor:pointer;font-family:var(--display)}
.cid{font-size:.8rem}
.foot{margin-top:3rem;font-size:.9rem;color:var(--muted);border-top:1px solid var(--rule);padding-top:1rem}
:focus-visible{outline:3px solid var(--clinker);outline-offset:2px}
@media (max-width:560px){.facts{grid-template-columns:repeat(2,minmax(0,1fr))}.ln{grid-template-columns:1fr;gap:0}}
'''

JS = '''
const a=new Audio();let cur=null;
document.addEventListener('click',e=>{const b=e.target.closest('.play');if(!b)return;
 if(cur===b){a.pause();b.classList.remove('on');b.querySelector('span').textContent='Play';cur=null;return;}
 if(cur){cur.classList.remove('on');cur.querySelector('span').textContent='Play';}
 a.src=b.dataset.src;a.play().catch(()=>{});b.classList.add('on');b.querySelector('span').textContent='Pause';cur=b;});
a.onended=()=>{if(cur){cur.classList.remove('on');cur.querySelector('span').textContent='Play';cur=null;}};
'''

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap">'
frag = f'<title>Scenic Loop Script</title>\n{FONTS}\n<style>{CSS}</style>\n<div class="wrap">{body}</div>\n<script>{JS}</script>\n'
full = f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="stylesheet" href="fonts/fonts.css">\n' + frag.replace(FONTS + '\n', '') + '</html>\n'
full = full.replace('<title>Scenic Loop Script</title>\n', '<title>Scenic Loop Script</title>\n</head>\n<body>\n', 1)
open(os.path.join(ROOT, 'app', 'script.html'), 'w').write(full)
if len(sys.argv) > 1:
    open(sys.argv[1], 'w').write(frag)
print('ok', len(full))
