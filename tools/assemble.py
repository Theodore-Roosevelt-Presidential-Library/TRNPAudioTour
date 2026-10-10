#!/usr/bin/env python3
"""Stitch voiced lines, animal sounds and Roosevelt's voice into one mp3 per clip, with caption cues.
Writes app/audio/<clip>.mp3 and app/audio/<clip>.json. Run tools/build_data.py afterwards."""
import json, os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from build_data import parse_script  # noqa
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 44100
LINES = {(e['clip'], e['i']): e for e in json.load(open(os.path.join(ROOT, 'script', 'lines.json')))}

def load(path, trim=True):
    af = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse' if trim else 'anull'
    pcm = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-af', af, '-ar', str(SR), '-ac', '1', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.float32).copy()

def fade(x, s=0.04):
    n = min(len(x) // 2, int(s * SR))
    if n: x[:n] *= np.linspace(0, 1, n); x[-n:] *= np.linspace(1, 0, n)
    return x

sil = lambda s: np.zeros(int(s * SR), np.float32)
tour = json.load(open(os.path.join(ROOT, 'app', 'data', 'tour.json')))
clips = parse_script(os.path.join(ROOT, 'script', 'tour-script.md'))
os.makedirs(os.path.join(ROOT, 'app', 'audio'), exist_ok=True)
only = set(sys.argv[1:])
for cid, c in clips.items():
    if only and cid not in only:
        continue
    parts, cues, t, prev = [sil(0.15)], [], 0.15, None
    ok = True
    for i, l in enumerate(c['lines']):
        sp = l['s']
        if sp in ('N', 'W', 'Q'):
            e = LINES.get((cid, i))
            f = os.path.join(ROOT, 'audio-src', 'lines', e['file']) if e else None
            if not f or not os.path.exists(f):
                print('missing line', cid, i); ok = False; break
            x = fade(load(f))
        elif sp == 'SFX':
            x = fade(load(os.path.join(ROOT, 'app', tour['sounds'][l['ref']]['file']), trim=False), 0.3) * 0.7
        else:  # TRV
            x = fade(load(os.path.join(ROOT, 'app', tour['trv'][l['ref']]['file']), trim=False), 0.1)
        if prev is not None:
            gap = 0.5 if 'Q' in (sp, prev) or sp in ('SFX', 'TRV') or prev in ('SFX', 'TRV') else (0.16 if sp == prev else 0.26)
            parts.append(sil(gap)); t += gap
        cues.append({'t': round(t, 2), 'i': i})
        parts.append(x); t += len(x) / SR; prev = sp
    if not ok:
        continue
    parts.append(sil(0.3))
    y = np.concatenate(parts)
    wav = f'/tmp/asm_{cid}.f32'
    y.astype(np.float32).tofile(wav)
    out = os.path.join(ROOT, 'app', 'audio', cid + '.mp3')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', wav,
                    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-b:a', '80k', out], check=True)
    os.remove(wav)
    meta = {'file': f'audio/{cid}.mp3', 'dur': round(len(y) / SR, 2), 'cues': cues}
    json.dump(meta, open(os.path.join(ROOT, 'app', 'audio', cid + '.json'), 'w'))
    print(f'{cid:28s} {meta["dur"]:6.1f}s')
