"""Transcribe each voiced line and compare it with the script text. Flags mismatches."""
import json, os, re, subprocess, difflib, sys
import numpy as np
from faster_whisper import WhisperModel
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
L = json.load(open(os.path.join(ROOT, 'script', 'lines.json')))
m = WhisperModel('base.en', device='cpu', compute_type='int8')
norm = lambda t: re.sub(r'[^a-z0-9 ]', ' ', re.sub(r'\[[^\]]+\]', ' ', t.lower())).split()
res = []
for e in L:
    f = os.path.join(ROOT, 'audio-src', 'lines', e['file'])
    if not os.path.exists(f):
        res.append({**e, 'score': 0, 'heard': 'MISSING'}); continue
    pcm = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', f, '-ar', '16000', '-ac', '1', '-f', 's16le', '-'], capture_output=True).stdout
    a = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
    heard = ' '.join(s.text for s in m.transcribe(a, beam_size=1)[0])
    sc = difflib.SequenceMatcher(None, norm(e['text']), norm(heard)).ratio()
    res.append({'file': e['file'], 'text': e['text'], 'heard': heard.strip(), 'score': round(sc, 2), 'dur': len(a) / 16000})
json.dump(res, open('/tmp/qa_lines.json', 'w'), indent=1)
bad = [r for r in res if r['score'] < 0.7]
print('checked', len(res), 'flagged', len(bad))
for r in bad: print(r['score'], r['file'], '\n   want:', r['text'][:110], '\n   got :', r['heard'][:110])
