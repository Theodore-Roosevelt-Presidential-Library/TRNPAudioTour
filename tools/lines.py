#!/usr/bin/env python3
"""List every spoken line that needs a voice recording, with a content hash.
Lines whose hash already has a file in audio-src/lines/ are marked done, so editing the
script only re-voices the lines that changed.  Output: script/lines.json"""
import json, hashlib, os, sys
sys.path.insert(0, os.path.dirname(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from build_data import parse_script  # noqa

VOICES = {'N': 78, 'Q': 78, 'W': 80}          # Artlist: Nora = Resonance, Wes = Keen
SAY = {                                        # pronunciation help for the voice model only
    'Marquis de Morès': 'mar-KEE duh mo-RESS', 'The Marquis': 'The mar-KEE', 'the Marquis': 'the mar-KEE',
    'de Morès': 'duh mo-RESS', 'Morès': 'Mo-RESS', 'Tolstoi': 'Tolstoy', "'Anna Karenina,'": 'Anna Karenina,',
    'porcupette': 'por-kyoo-PET', 'coteries': 'KOH-tuh-reez', 'maltee': 'MAWL-tee', 'Snøhetta': 'SNOW-het-tah',
}
def tts_text(t):
    for a, b in SAY.items():
        t = t.replace(a, b)
    return t.replace('…', '... ').strip()

clips = parse_script(os.path.join(ROOT, 'script', 'tour-script.md'))
import shutil
LD = os.path.join(ROOT, 'audio-src', 'lines')
out, have = [], set(os.listdir(os.path.join(ROOT, 'audio-src', 'lines'))) if os.path.isdir(os.path.join(ROOT, 'audio-src', 'lines')) else set()
for cid, c in clips.items():
    for i, l in enumerate(c['lines']):
        if l['s'] not in VOICES:
            continue
        txt = tts_text(l['t'])
        h = hashlib.sha1(f"{l['s']}|{VOICES[l['s']]}|{txt}".encode()).hexdigest()[:10]
        fn = f'{cid}--{i:02d}--{h}.mp3'
        if fn not in have:  # same words already voiced under another position? reuse it
            twin = next((f for f in have if f.startswith(cid + '--') and f.endswith('--' + h + '.mp3')), None)
            if twin:
                shutil.copy(os.path.join(LD, twin), os.path.join(LD, fn)); have.add(fn)
        out.append({'clip': cid, 'i': i, 'speaker': l['s'], 'voiceId': VOICES[l['s']], 'text': txt, 'file': fn, 'done': fn in have})
json.dump(out, open(os.path.join(ROOT, 'script', 'lines.json'), 'w'), indent=1, ensure_ascii=False)
todo = [x for x in out if not x['done']]
print(len(out), 'lines;', len(todo), 'to record;', sum(len(x['text']) for x in todo), 'characters')
