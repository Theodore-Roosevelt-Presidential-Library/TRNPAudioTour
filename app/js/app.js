/* Scenic Loop with Nora & Wes — GPS driving tour engine.
   No build step, no dependencies. Works offline once the tour is downloaded (see sw.js). */
(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const MI = 1609.344;
const CFG = {
  minGapS: 6,            // quiet seconds between clips
  parkSpeed: 2,          // mph at or below = stopped
  parkHoldS: 10,         // seconds stopped before we call it "parked"
  unlockSpeed: 3,        // interactive panel allowed at or below this
  slowFrom: 12,          // had to be moving faster than this…
  slowTo: 6,             // …then drop below this to count as a slowdown
  slowHoldS: 4,
  overBy: 4,             // mph over the limit before we nudge
  overHoldS: 8,
  nudgeCooldownS: 300,
  nudgeMax: 3,
  stopRadiusM: 220,      // "at a stop" radius around the road point
  offRouteM: 300,
  gpsWeakAccM: 80,
};

// ------------------------------------------------------------------ state
const S = {
  tour: null, sim: null, started: false, mode: 'gps',
  pos: null, speed: 0, speedHist: [], heading: 0, accuracy: 0, lastFix: 0,
  phase: 'out', dir: null, tp: 0, onSpur: null, spurMi: 0, routeDist: 0, mi: 0,
  played: new Set(), skipped: new Set(), queue: [], current: null, paused: null, lastEnd: 0,
  stillSince: 0, parkedAt: null, slowArmed: false, slowSince: 0, pickerOpen: false, pickerDismissedAt: 0,
  overSince: 0, nudges: 0, lastNudge: -1e9, crawlSince: 0, offSince: 0, offWarned: false, weakWarnAt: -1e9,
  storyIdx: 0, tally: {}, lastClip: null, userPaused: false, photoTimer: null, photos: [], photoIdx: 0, mapGeom: null,
};
try { S.tally = JSON.parse(localStorage.getItem('trnp-tally') || '{}'); } catch (e) { S.tally = {}; }
const saveTally = () => { try { localStorage.setItem('trnp-tally', JSON.stringify(S.tally)); } catch (e) {} };
const TEST = new URLSearchParams(location.search).get('fast') ? 1 : 0; // automated tests: silent, 20x narration
const LOG = window.__tourLog = [];
const log = (ev, extra) => LOG.push({ ev, t: +(performance.now() / 1000).toFixed(1), phase: S.phase, dir: S.dir, tp: +S.tp.toFixed(2), mi: +S.mi.toFixed(2), spur: S.onSpur, mph: Math.round(S.speed), ...extra });
const realNow = () => performance.now() / 1000 * (TEST ? 20 : 1);
// in the preview, the simulated car's clock drives all timing so fast-forwarding stays consistent
const now = () => (S.simT != null ? S.simT : realNow());

// ------------------------------------------------------------------ geometry
function lonlatToXY(lon, lat, lat0) {
  return [lon * Math.cos(lat0 * Math.PI / 180) * 111320, lat * 110540];
}
function makeTrack(coords, cumMi) {
  const lat0 = coords[0][1];
  const xy = coords.map(c => lonlatToXY(c[0], c[1], lat0));
  return { coords, cum: cumMi, xy, lat0 };
}
// nearest point on a track, optionally limited to [lo, hi] miles
function nearest(track, lon, lat, lo = -1, hi = 1e9) {
  const [px, py] = lonlatToXY(lon, lat, track.lat0);
  let best = null;
  for (let i = 1; i < track.xy.length; i++) {
    if (track.cum[i] < lo || track.cum[i - 1] > hi) continue;
    const [ax, ay] = track.xy[i - 1], [bx, by] = track.xy[i];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(px - qx, py - qy);
    if (!best || d < best.d) best = { d, mi: track.cum[i - 1] + t * (track.cum[i] - track.cum[i - 1]), i, t };
  }
  return best;
}
function pointAt(track, mi) {
  const c = track.cum;
  let i = 1; while (i < c.length - 1 && c[i] < mi) i++;
  const t = Math.max(0, Math.min(1, (mi - c[i - 1]) / ((c[i] - c[i - 1]) || 1)));
  const a = track.coords[i - 1], b = track.coords[i];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI];
}
function distM(a, b) { // [lon,lat]
  const R = 6371008.8, r = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// travel-path position ("tp", miles from the visitor center along the way you are actually driving)
function stopTp(st) {
  const R = S.tour.route;
  if (st.mi == null) return null;
  if (st.on === 'stem') return st.mi; // outbound
  if (S.dir === 'ccw') return R.junctionOut + (R.junctionIn - st.mi);
  return st.mi;
}
function inboundTpForStem(mi) { const R = S.tour.route; return R.junctionIn + (R.junctionOut - mi); }

// ------------------------------------------------------------------ locate
function locate(lon, lat) {
  const T = S.tour, R = T.route, tr = S.track;
  const stem = nearest(tr, lon, lat, 0, R.junctionOut);
  const loop = nearest(tr, lon, lat, R.junctionOut, R.junctionIn);
  let spur = null;
  for (const [k, sp] of Object.entries(S.spurs)) {
    const n = nearest(sp, lon, lat);
    if (n && n.mi > 0.05 && (!spur || n.d < spur.d)) spur = { ...n, key: k };
  }
  const best = Math.min(stem.d, loop.d, spur ? spur.d : 1e9);
  S.routeDist = best;

  if (spur && spur.d === best && spur.d < 60) {
    S.onSpur = spur.key; S.spurMi = spur.mi; return;
  }
  S.onSpur = null;

  const prevPhase = S.phase;
  // Which track are we on?
  const onLoop = loop.d < stem.d - 5 || (S.phase === 'loop' && loop.d <= stem.d + 5);
  if (S.phase === 'out') {
    if (onLoop && loop.d < 120) {
      const u = loop.mi;
      if (!S.dir) {
        if (u > R.junctionOut + 0.08 && u < R.junctionOut + 4) S.dir = 'cw';
        else if (u < R.junctionIn - 0.08 && u > R.junctionIn - 4) S.dir = 'ccw';
      }
      if (S.dir) S.phase = 'loop';
    }
    if (S.phase === 'out') { S.tp = stem.mi; S.mi = stem.mi; }
  }
  if (S.phase === 'loop') {
    let u = loop.mi;
    const tpOf = (x) => S.dir === 'ccw' ? R.junctionOut + (R.junctionIn - x) : x;
    // the loop closes on itself at the junction: pick whichever end keeps us continuous
    if (u - R.junctionOut < 0.4 || R.junctionIn - u < 0.4) {
      const alt = u - R.junctionOut < 0.4 ? R.junctionIn - (u - R.junctionOut) : R.junctionOut + (R.junctionIn - u);
      if (Math.abs(tpOf(alt) - S.tp) < Math.abs(tpOf(u) - S.tp)) u = alt;
    }
    S.mi = u;
    const tp = tpOf(u);
    // detect a U-turn on the loop: moving backwards for a while
    if (tp < S.tp - 0.35 && S.tp - tp < 3 && Math.abs(tp - S.tp) < 3) { S.dir = S.dir === 'cw' ? 'ccw' : 'cw'; S.tp = S.dir === 'ccw' ? R.junctionOut + (R.junctionIn - u) : u; }
    else S.tp = tp;
    const coverage = S.tp - R.junctionOut, loopLen = R.junctionIn - R.junctionOut;
    if (!onLoop && stem.d < 80 && coverage > loopLen * 0.6) S.phase = 'in';
  }
  if (S.phase === 'in') { S.mi = stem.mi; S.tp = inboundTpForStem(stem.mi); }
  if (prevPhase !== S.phase) render.phase();
}

// ------------------------------------------------------------------ speed limit
function limitHere() {
  if (S.onSpur) return S.tour.spurs[S.onSpur].mph;
  // speed table is keyed on clockwise polyline miles
  let mi = S.mi;
  if (S.phase === 'out') mi = S.mi; else if (S.phase === 'in') mi = S.tour.route.total - S.mi;
  const seg = S.tour.speed.find(s => mi >= s.from && mi <= s.to) || { mph: 25 };
  return seg.mph;
}

// ------------------------------------------------------------------ audio
const audioEl = new Audio(); audioEl.preload = 'auto';
const sfxEl = new Audio();
let ttsVoices = [];
function loadVoices() {
  const all = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  const en = all.filter(v => /^en(-|_)US/i.test(v.lang)) .concat(all.filter(v => /^en/i.test(v.lang)));
  const fem = en.find(v => /samantha|female|zira|aria|jenny|google us english/i.test(v.name)) || en[0];
  const male = en.find(v => v !== fem && /alex|daniel|male|guy|david|fred|aaron/i.test(v.name)) || en.find(v => v !== fem) || fem;
  ttsVoices = { N: fem, Q: fem, W: male };
}
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

function estDur(clip) {
  if (clip.audio && clip.audio.dur) return clip.audio.dur;
  let s = 0;
  for (const l of clip.lines) {
    if (l.t) s += l.t.split(/\s+/).length / 2.6 + 0.4;
    if (l.s === 'SFX') s += 6; if (l.s === 'TRV') s += 7;
  }
  return s;
}

// A playing clip: {clip, kind, lineIdx, startedAt, stop()}
function playClip(id, { priority = 0, onDone } = {}) {
  const clip = S.tour.clips[id]; if (!clip) return;
  S.played.add(id); S.lastClip = id; log('clip', { id });
  const job = { id, clip, priority, lineIdx: 0, cancelled: false, onDone };
  S.current = job;
  render.clipStarted(job);
  if (clip.audio && clip.audio.file && !TEST) playFile(job); else playLines(job);
}
function finish(job) {
  if (job.cancelled) return;
  S.current = null; S.lastEnd = now();
  render.caption(null);
  if (job.onDone) job.onDone();
  if (S.paused && !S.queue.length) { const p = S.paused; S.paused = null; resume(p); }
}
function playFile(job) {
  const a = job.clip.audio;
  audioEl.src = a.file; audioEl.currentTime = job.resumeAt || 0;
  audioEl.onended = () => finish(job);
  audioEl.ontimeupdate = () => {
    const t = audioEl.currentTime; const cue = (a.cues || []).filter(c => c.t <= t).pop();
    if (cue && cue !== job.cue) { job.cue = cue; job.lineIdx = cue.i; render.caption(job.clip.lines[cue.i]); }
  };
  audioEl.onerror = () => { job.clip.audio = null; playLines(job); };
  audioEl.play().catch(() => {});
}
function playLines(job) {
  const lines = job.clip.lines;
  const step = () => {
    if (job.cancelled) return;
    if (job.lineIdx >= lines.length) return finish(job);
    const l = lines[job.lineIdx];
    render.caption(l);
    const next = () => { job.lineIdx++; setTimeout(step, 250 / (TEST ? 20 : 1)); };
    if (l.s === 'SFX') return playSfx(S.tour.sounds[l.ref].file, next);
    if (l.s === 'TRV') return playSfx(S.tour.trv[l.ref].file, next);
    if (!window.speechSynthesis || TEST) return setTimeout(next, l.t.split(' ').length * 380 / (TEST ? 20 : 1));
    const u = new SpeechSynthesisUtterance(l.t.replace(/\[[^\]]+\]\s*/g, '').replace(/—/g, ', '));
    u.voice = ttsVoices[l.s] || null; u.rate = 1.02; u.pitch = l.s === 'W' ? 0.85 : 1.08;
    // watchdog: some browsers never fire onend (no voices installed, background tab)
    let fired = false; const once = () => { if (fired) return; fired = true; clearTimeout(job.wd); next(); };
    u.onend = once; u.onerror = once;
    job.wd = setTimeout(once, (l.t.split(/\s+/).length * 0.45 + 2.5) * 1000);
    job.utter = u; speechSynthesis.speak(u);
  };
  step();
}
function playSfx(file, done) {
  if (TEST) return setTimeout(done, 300);
  sfxEl.src = file; sfxEl.onended = done; sfxEl.onerror = done; sfxEl.play().catch(() => done());
}
function stopCurrent(keepForResume) {
  const job = S.current; if (!job) return null;
  job.cancelled = true; job.savedIdx = job.lineIdx;
  if (job.clip.audio && job.clip.audio.file) { job.resumeAt = Math.max(0, audioEl.currentTime - 1.5); audioEl.pause(); }
  if (window.speechSynthesis) speechSynthesis.cancel();
  clearTimeout(job.wd);
  sfxEl.pause();
  S.current = null; render.caption(null);
  return keepForResume ? job : null;
}
function resume(job) {
  const clip = job.clip; const j2 = { ...job, cancelled: false, lineIdx: job.savedIdx != null ? job.savedIdx : job.lineIdx };
  S.current = j2; render.clipStarted(j2);
  if (clip.audio && clip.audio.file && !TEST) playFile(j2); else playLines(j2);
}
// Interrupt for something urgent (wildlife), then come back to what was playing
function interrupt(id) {
  const was = stopCurrent(true);
  if (was && !S.paused) S.paused = was;
  playClip(id, { priority: 9 });
}
function enqueue(id, priority = 1) {
  if (S.played.has(id) || S.queue.some(q => q.id === id) || (S.current && S.current.id === id)) return;
  S.queue.push({ id, priority }); S.queue.sort((a, b) => b.priority - a.priority);
}
function pump() {
  if (S.current || S.userPaused) return;
  if (S.paused) { const p = S.paused; S.paused = null; return resume(p); }
  if (now() - S.lastEnd < CFG.minGapS) return;
  let q = S.queue.shift();
  while (q && isStale(q.id)) { S.skipped.add(q.id); q = S.queue.shift(); }
  if (q) playClip(q.id, { priority: q.priority });
}

// a queued stop clip is stale once you are well past that stop (and not parked at it)
function isStale(id) {
  const st = S.tour.stops.find(s => s.approach === id); if (!st || st.mi == null) return false;
  if (S.parkedAt && S.parkedAt.id === st.id) return false;
  let d;
  if (st.on === 'stem') { if (S.phase !== 'out') return true; d = st.mi - S.tp; }
  else { if (S.phase !== 'loop') return S.phase === 'in'; d = stopTp(st) - S.tp; }
  return d < (st.kind === 'nav' ? -0.1 : -0.4);
}

// ------------------------------------------------------------------ the trigger engine
function upcoming() {
  const T = S.tour, out = [];
  for (const st of T.stops) {
    if (st.kind === 'spurend' || st.kind === 'start') continue;
    let tp;
    if (S.phase === 'out') { if (st.on === 'stem') tp = st.mi; else if (S.dir) tp = stopTp(st); else continue; }
    else if (S.phase === 'loop') { if (st.on === 'stem') continue; tp = stopTp(st); }
    else { if (st.on !== 'stem' || st.kind === 'nav') continue; tp = inboundTpForStem(st.mi); }
    const d = tp - S.tp; if (d > -0.05) out.push({ st, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}
function leadMiles(clipId) {
  const clip = S.tour.clips[clipId];
  const v = Math.max(limitHere(), 15);
  return Math.min(0.9, Math.max(0.2, estDur(clip) * v / 3600 * 0.55));
}

function tick() {
  if (!S.pos) return;
  const t = now(), T = S.tour;
  const spd = S.speed;
  const lim = limitHere();

  // ---- approach triggers (stops ahead of you, in travel order)
  const ups = upcoming();
  if (S.phase !== 'in' && !S.onSpur) {
    for (const { st, d } of ups) {
      if (!st.approach || S.played.has(st.approach) || S.skipped.has(st.approach)) continue;
      if (st.on === 'stem' && S.phase !== 'out') continue;
      const lead = st.kind === 'nav' ? 0.25 : leadMiles(st.approach);
      if (d <= lead) enqueue(st.approach, st.kind === 'nav' ? 6 : 5);
    }
    // stops you have driven past without hearing about them
    for (const st of T.stops) {
      if (!st.approach || S.played.has(st.approach) || S.skipped.has(st.approach) || st.mi == null) continue;
      if (S.phase === 'loop' && st.on === 'stem') continue;
      if (S.phase === 'out' && st.on !== 'stem') continue;
      const d = (S.phase === 'out' ? st.mi : stopTp(st)) - S.tp;
      if (d < -0.3) { S.skipped.add(st.approach); S.queue = S.queue.filter(q => q.id !== st.approach); }
    }
  }

  // ---- closing on the way home
  if (S.phase === 'in' && S.tp > T.route.junctionIn + 0.25 && !S.played.has('closing')) enqueue('closing', 8);

  // ---- parked
  if (spd <= CFG.parkSpeed) { if (!S.stillSince) S.stillSince = t; } else { S.stillSince = 0; }
  const parked = S.stillSince && t - S.stillSince >= CFG.parkHoldS;
  const here = nearestStop();
  // walked off with the phone before the 10-second hold? slow and right at a pull-off counts as parked too
  const atPull = here && here.dist < CFG.stopRadiusM && here.st.kind !== 'nav' && here.st.kind !== 'driveby';
  if (spd < 6 && atPull) { if (!S.slowAtPull) S.slowAtPull = t; } else S.slowAtPull = 0;
  if ((parked || (S.slowAtPull && t - S.slowAtPull > 15)) && !S.parkedAt) onParked(here);
  // on foot: parked, then the phone moves away from where the car stopped
  if (S.parkedAt && S.parkSpot && S.pos) {
    const away = distM(S.parkSpot, S.pos);
    if (!S.walking && away > 35 && spd < 7) { S.walking = true; log('walking', { at: S.parkedAt.id }); render.walking(true); }
    if (S.walking && away < 20 && spd <= CFG.parkSpeed) { S.walking = false; render.walking(false); }
  }
  // back in the car: driving speed held for a few seconds (GPS jumps while walking don't count)
  if (S.parkedAt && spd > 9) { if (!S.driveSince) S.driveSince = t; } else S.driveSince = 0;
  if (S.parkedAt && S.driveSince && t - S.driveSince > 4) onUnparked(t);

  // ---- slowdown → wildlife picker
  if (spd > CFG.slowFrom) S.slowArmed = true;
  const nearPull = here && here.dist < CFG.stopRadiusM;
  if (S.slowArmed && spd < CFG.slowTo && !nearPull && !S.onSpur && !S.parkedAt) {
    if (!S.slowSince) S.slowSince = t;
    if (t - S.slowSince > CFG.slowHoldS && !S.pickerOpen && t - S.pickerDismissedAt > 45) { openPicker(); S.slowArmed = false; }
  } else S.slowSince = 0;
  if (S.pickerOpen && spd > 14 && !S.pickerManual) closePicker();

  // ---- speed pacing
  if (spd > lim + CFG.overBy) {
    if (!S.overSince) S.overSince = t;
    if (t - S.overSince > CFG.overHoldS && S.nudges < CFG.nudgeMax && t - S.lastNudge > CFG.nudgeCooldownS && !S.current) {
      S.nudges++; S.lastNudge = t; playClip('sys-speed-' + S.nudges, { priority: 7 });
    }
  } else S.overSince = 0;
  // crawling with traffic behind (a guess): well under the limit for 2.5 minutes, not near a stop
  if (spd > 5 && spd < lim * 0.5 && !nearPull && !S.parkedAt) { if (!S.crawlSince) S.crawlSince = t; if (t - S.crawlSince > 150) enqueue('sys-line-behind', 2); }
  else S.crawlSince = 0;

  // ---- off route
  if (S.routeDist > CFG.offRouteM && !(here && here.dist < 450) && !S.parkedAt) {
    if (!S.offSince) S.offSince = t;
    if (t - S.offSince > 30 && !S.offWarned) { S.offWarned = true; S.played.delete('sys-off-route'); enqueue('sys-off-route', 6); }
  } else { S.offSince = 0; S.offWarned = false; }

  // ---- stories fill quiet stretches
  if (!S.current && !S.queue.length && !S.parkedAt && t - S.lastEnd > CFG.minGapS + 4 && spd > 3) maybeStory(ups);

  pump();
  render.tick(ups);
}

function maybeStory(ups) {
  const T = S.tour;
  if (S.phase === 'in') return; // home stretch belongs to the closing
  const nxt = ups.find(u => u.st.approach && !S.played.has(u.st.approach) && !S.skipped.has(u.st.approach));
  const v = Math.max(S.speed, limitHere() * 0.7, 10);
  const roomS = nxt ? Math.max(0, (nxt.d - leadMiles(nxt.st.approach))) / v * 3600 : 9999;
  // the rebuilt stretch gets its own story
  const z = T.zones['rebuilt-section'];
  if (S.phase === 'loop' && !S.played.has('rebuilt-road') && S.mi >= z.from && S.mi <= z.to && estDur(T.clips['rebuilt-road']) + 4 < roomS) return enqueue('rebuilt-road', 3);
  for (const id of T.stories) {
    if (S.played.has(id)) continue;
    const c = T.clips[id];
    if (c.time === 'evening' && !isEvening()) continue;
    if (id === 'story-his-voice' && S.phase === 'out') continue;
    if (estDur(c) + 4 < roomS) return enqueue(id, 2);
  }
}
function isEvening() {
  // rough sunset for Medora (46.9N): ~16:50 in Dec to ~21:40 in late June, local time
  const d = new Date(), doy = (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5;
  const sunset = 19.25 + 2.4 * Math.sin((doy - 81) / 365 * 2 * Math.PI); // hours, MDT-ish
  const h = d.getHours() + d.getMinutes() / 60;
  return h > sunset - 1.2 || h < 5;
}

function nearestStop() {
  if (!S.pos) return null;
  let best = null;
  for (const st of S.tour.stops) {
    const pts = [[st.lon, st.lat]]; if (st.road) pts.push(st.road);
    const d = Math.min(...pts.map(p => distM(p, S.pos)));
    if (!best || d < best.dist) best = { st, dist: d };
  }
  return best;
}

function onParked(here) {
  log('parked', { at: here && here.dist < CFG.stopRadiusM + 150 ? here.st.id : null });
  S.parkedAt = here && here.dist < CFG.stopRadiusM + 150 ? here.st : { id: 'generic', name: 'Parked', photos: S.photos.slice(0, 4), quiz: [] };
  const st = S.parkedAt;
  S.parkSpot = S.pos ? S.pos.slice() : null; S.parkedT = now(); S.walking = false;
  if (st.id === 'visitor-center' && !S.played.has('welcome')) return; // welcome handles itself
  if (st.approach && !S.played.has(st.approach)) { S.skipped.delete(st.approach); enqueue(st.approach, 6); }
  if (st.parked && !S.played.has(st.parked)) enqueue(st.parked, 6);
  render.parked(st);
}
function onUnparked(t) {
  const st = S.parkedAt, long = S.parkedT && (t || now()) - S.parkedT > 120;
  // you drove off before the "on foot" clip got its turn: drop it, it can play if you come back
  if (st && st.parked) S.queue = S.queue.filter(q => q.id !== st.parked);
  S.parkedAt = null; S.parkSpot = null; S.driveSince = 0; S.slowAtPull = 0;
  if (S.walking) { S.walking = false; render.walking(false); }
  render.unparked();
  // a quick "here we go" after a real stop, so you know the tour picked back up
  if (long && st && st.id !== 'visitor-center') { S.played.delete('sys-resume'); enqueue('sys-resume', 4); }
}

// ------------------------------------------------------------------ wildlife picker
function openPicker(manual) {
  log('picker');
  S.pickerOpen = true; S.pickerManual = !!manual; $('picker').hidden = false;
}
function closePicker() { S.pickerOpen = false; S.pickerManual = false; S.pickerDismissedAt = now(); $('picker').hidden = true; }
function pickAnimal(w) {
  log('pick', { w: w.id });
  closePicker();
  if (w.id !== 'traffic') { S.tally[w.id] = (S.tally[w.id] || 0) + 1; saveTally(); }
  S.played.delete(w.clip);
  interrupt(w.clip);
}

// ------------------------------------------------------------------ GPS
let watchId = null, wakeLock = null;
function startGps() {
  if (!('geolocation' in navigator)) return alert('This phone does not share its location with the browser, so the tour cannot follow you.');
  watchId = navigator.geolocation.watchPosition(onFix, (err) => {
    if (err.code === 1) showDialog('<h3>Location is off</h3><p>The tour needs your location to know where you are on the loop. Turn on location for this site in your browser settings, then reload.</p>');
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  setInterval(() => { // weak GPS watchdog
    const stale = now() - S.lastFix > 20, bad = S.accuracy > CFG.gpsWeakAccM;
    $('gps-badge').hidden = !(stale || bad);
    if ((stale || bad) && now() - S.weakWarnAt > 900 && S.started && S.mode === 'gps') { S.weakWarnAt = now(); S.played.delete('sys-gps-weak'); enqueue('sys-gps-weak', 3); }
  }, 5000);
}
function onFix(p) {
  const c = p.coords;
  const prev = S.pos, pt = Date.now() / 1000;
  S.pos = [c.longitude, c.latitude]; S.accuracy = c.accuracy || 0; S.lastFix = now();
  let mph = c.speed != null && !isNaN(c.speed) ? c.speed * 2.23694 : null;
  if (mph == null && prev && S.prevT) mph = distM(prev, S.pos) / Math.max(0.5, pt - S.prevT) * 2.23694;
  S.prevT = pt;
  feedSpeed(mph || 0, c.heading);
  locate(S.pos[0], S.pos[1]);
  tick();
}
function feedSpeed(mph, heading) {
  S.speedHist.push(mph); if (S.speedHist.length > 4) S.speedHist.shift();
  S.speed = S.speedHist.reduce((a, b) => a + b, 0) / S.speedHist.length;
  if (heading != null && !isNaN(heading)) S.heading = heading;
}
async function keepAwake() {
  try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.started) keepAwake(); });

// ------------------------------------------------------------------ simulator ("Preview the drive")
function buildSimPath(dir, withSpurs) {
  // returns array of {lon,lat,mph,stop?:stopId,spur?} waypoints every ~25 m along the drive
  const T = S.tour, R = T.route, tr = S.track, pts = [];
  const push = (lon, lat, mph, extra) => pts.push({ lon, lat, mph, ...extra });
  const segMph = (mi) => (T.speed.find(s => mi >= s.from && mi <= s.to) || { mph: 25 }).mph;
  const walk = (from, to, mapMi) => {
    const step = 0.016 * Math.sign(to - from);
    for (let m = from; step > 0 ? m < to : m > to; m += step) { const [lon, lat] = pointAt(tr, m); push(lon, lat, segMph(mapMi ? mapMi(m) : m), { mi: m }); }
  };
  const spurTrip = (key) => {
    const sp = S.spurs[key], len = sp.cum[sp.cum.length - 1];
    for (let m = 0; m < len; m += 0.016) { const [lon, lat] = pointAt(sp, m); push(lon, lat, T.spurs[key].mph); }
    pts.push({ ...pts[pts.length - 1], hold: 90, stop: T.spurs[key].end });
    for (let m = len; m > 0; m -= 0.016) { const [lon, lat] = pointAt(sp, m); push(lon, lat, T.spurs[key].mph); }
  };
  { let m0 = 0; // outbound stem, pausing at its pull-offs
    for (const st of T.stops.filter(s => s.on === 'stem' && s.kind === 'pulloff' && s.mi > 0).sort((a, b) => a.mi - b.mi)) {
      walk(m0, st.mi); m0 = st.mi; pts.push({ ...pts[pts.length - 1], mark: st.id });
    }
    walk(m0, R.junctionOut); }
  const loopStops = T.stops.filter(s => s.on === 'loop' && s.mi != null);
  if (dir === 'cw') {
    let m = R.junctionOut;
    for (const st of loopStops.slice().sort((a, b) => a.mi - b.mi)) {
      walk(m, st.mi); m = st.mi; pts.push({ ...pts[pts.length - 1], mark: st.id });
      if (withSpurs && st.kind === 'spurturn') spurTrip(st.spur);
    }
    walk(m, R.junctionIn);
  } else {
    let m = R.junctionIn;
    for (const st of loopStops.slice().sort((a, b) => b.mi - a.mi)) {
      walk(m, st.mi); m = st.mi; pts.push({ ...pts[pts.length - 1], mark: st.id });
      if (withSpurs && st.kind === 'spurturn') spurTrip(st.spur);
    }
    walk(m, R.junctionOut);
  }
  // home along the stem
  for (let m = R.junctionOut; m > 0; m -= 0.016) { const [lon, lat] = pointAt(tr, m); push(lon, lat, segMph(R.total - m)); }
  return pts;
}
function startSim() {
  const opts = { dir: $('sim-dir').value, rate: +$('sim-rate').value, stops: $('sim-stops').checked, wild: $('sim-wild').checked, speeder: $('sim-speeder').checked };
  const path = buildSimPath(opts.dir, opts.stops);
  const pullStops = new Set(S.tour.stops.filter(s => s.kind === 'pulloff').map(s => s.id));
  let i = 0, hold = opts.stops ? 30 : 0, mph = 0, carry = 0, slowLeft = 0, fastLeft = 0, lastMark = null;
  if (S.sim) clearInterval(S.sim);
  S.dir = null; S.phase = 'out'; S.tp = 0; S.parkedAt = null; S.stillSince = 0;
  const dt = 0.5;
  S.simT = Math.max(S.simT || 0, realNow());
  window.__S = S;
  S.sim = setInterval(() => {
    // fast-forward only through quiet stretches, so the preview stays in sync with the narration
    const rate = S.current || S.queue.length ? 1 : +$('sim-rate').value;
    for (let k = 0; k < rate; k++) {
      if (i >= path.length - 1) { clearInterval(S.sim); feedSpeed(0); tick(); return; }
      S.simT += dt;
      let target = path[i].mph;
      if (hold > 0) { hold -= dt; target = 0; }
      else if (slowLeft > 0) { slowLeft -= dt; target = 2; }
      else if (fastLeft > 0) { fastLeft -= dt; target += 14; }
      else if (opts.wild && Math.random() < 0.0005) slowLeft = 18;
      else if (opts.speeder && Math.random() < 0.002) fastLeft = 30;
      mph += Math.max(-6, Math.min(4, target - mph)) * dt;
      mph = Math.max(0, mph);
      carry += mph / 3600 * dt;
      while (carry > 0.016 && i < path.length - 1) {
        carry -= 0.016; i++;
        const p = path[i];
        if (p.hold && opts.stops) hold = p.hold;
        if (p.mark && p.mark !== lastMark) { lastMark = p.mark; if (opts.stops && pullStops.has(p.mark)) hold = 80; }
      }
      const p = path[i];
      S.pos = [p.lon, p.lat]; S.lastFix = now(); S.accuracy = 8;
      feedSpeed(mph);
      locate(p.lon, p.lat);
      tick();
    }
  }, dt * 1000 / (TEST ? 20 : 1));
}

// ------------------------------------------------------------------ rendering
const render = {
  setPhotos(list) {
    const key = list.join('|'); if (key === S.photosKey) return; S.photosKey = key;
    S.photos = list.slice(); S.photoIdx = 0; this.showPhoto();
    clearInterval(S.photoTimer); if (list.length > 1) S.photoTimer = setInterval(() => { S.photoIdx = (S.photoIdx + 1) % S.photos.length; this.showPhoto(); }, 14000);
  },
  showPhoto() {
    const name = S.photos[S.photoIdx]; if (!name) return;
    const a = $('photo-a'), b = $('photo-b');
    const [cur, nxt] = a.classList.contains('on') ? [a, b] : [b, a];
    const fr = S.tour.photos[name] || {};
    nxt.onload = () => {
      // a wide shot on a tall screen (or the reverse) would lose its subject to the crop: show it whole instead
      const st = $('photo-fill').parentElement, sa = st.clientWidth / Math.max(1, st.clientHeight), pa = nxt.naturalWidth / Math.max(1, nxt.naturalHeight);
      const fit = fr.fit === 'contain' || Math.max(sa / pa, pa / sa) > 1.45 ? 'contain' : 'cover';
      nxt.classList.toggle('contain', fit === 'contain');
      nxt.style.objectPosition = fit === 'contain' ? '50% 30%' : (fr.focus || '50% 50%'); // contained: sit above the captions
      nxt.style.transformOrigin = fr.focus || '50% 50%';
      $('photo-fill').style.backgroundImage = fit === 'contain' ? `url(media/photos/${name}.jpg)` : 'none';
      nxt.classList.add('on'); cur.classList.remove('on');
    };
    nxt.src = 'media/photos/' + name + '.jpg';
    nxt.alt = (S.tour.photos[name] || {}).title || '';
    const c = S.tour.photos[name] || {}; const cb = $('photo-credit'); cb.hidden = !c.credit; cb.title = c.credit || ''; cb.setAttribute('aria-label', 'About this photo' + (c.credit ? ': ' + c.credit : ''));
  },
  clipStarted(job) {
    const c = job.clip;
    if (c.images && c.images.length) this.setPhotos(c.images);
    const k = c.kind || '';
    if (k.startsWith('stop') || k === 'nav' || k === 'start' || k === 'end' || k === 'story' || k === 'wildlife') {
      $('place-name').textContent = c.title;
      const st = c.stop && S.tour.stops.find(s => s.id === c.stop);
      $('place-meta').textContent = k === 'story' ? 'Story' : k === 'wildlife' ? 'Wildlife' : st ? st.name : '';
    }
    if (c.visual === 'bisonchart' && S.parkedAt == null) this.inlineViz(vizBison());
  },
  inlineViz(html) { /* shown in parked panel or dialog only, to keep the driving screen calm */ },
  caption(line) {
    const who = $('cap-who'), p = $('cap-text');
    if (!line) { who.textContent = ''; who.className = 'who'; p.textContent = ''; p.className = ''; return; }
    const H = S.tour.hosts;
    if (line.s === 'SFX') { who.textContent = '♪'; who.className = 'who'; p.textContent = (S.tour.sounds[line.ref] || {}).title || 'Listen'; p.className = ''; return; }
    if (line.s === 'TRV') { who.textContent = 'T.R.'; who.className = 'who Q'; p.textContent = '“' + S.tour.trv[line.ref].caption + '” — his own voice, 1912'; p.className = 'quote'; return; }
    who.textContent = line.s === 'Q' ? 'Roosevelt' : H[line.s].name; who.className = 'who ' + line.s;
    p.textContent = line.s === 'Q' ? '“' + line.t + '”' : line.t.replace(/\[[^\]]+\]\s*/g, '');
    p.className = line.s === 'Q' ? 'quote' : '';
  },
  phase() {},
  tick(ups) {
    const g = $('gauge'), lim = limitHere(), spd = Math.round(S.speed);
    $('spd').textContent = spd;
    $('limit').querySelector('b').textContent = lim;
    let pace = 'ok', msg = 'Right on pace';
    if (S.walking) { pace = 'still'; msg = 'On foot — the tour waits for you'; }
    else if (S.speed <= CFG.parkSpeed) { pace = 'still'; msg = S.parkedAt ? 'Parked' : 'Stopped'; }
    else if (S.speed > lim + CFG.overBy) { pace = 'hot'; msg = 'Ease off — you’ll miss the stories'; }
    else if (S.speed > lim + 1) { pace = 'warm'; msg = 'A little quick'; }
    else if (S.speed < lim * 0.5) { msg = 'Taking it slow'; }
    g.dataset.pace = pace; $('pace-msg').textContent = msg;

    const nx = (ups || []).find(u => u.st.kind !== 'nav' || u.d > 0) || null;
    if (S.onSpur) {
      const sp = S.tour.spurs[S.onSpur], end = S.tour.stops.find(s => s.id === sp.end);
      const left = sp.cum[sp.cum.length - 1] - S.spurMi;
      $('next-name').textContent = end.name; $('next-mi').textContent = fmtMi(Math.max(0, left)); $('next-side').textContent = 'side road';
    } else if (nx) {
      $('next-name').textContent = nx.st.name; $('next-mi').textContent = fmtMi(nx.d);
      let side = nx.st.side_cw; if (side && S.phase === 'loop' && S.dir === 'ccw') side = side === 'left' ? 'right' : 'left';
      if (S.phase === 'out' && nx.st.on === 'loop') side = null;
      $('next-side').textContent = side ? 'on your ' + side : '';
    } else if (S.phase === 'in') { $('next-name').textContent = 'Medora'; $('next-mi').textContent = fmtMi(Math.max(0, S.tour.route.total - S.tp)); $('next-side').textContent = ''; }
    if (!S.current && !S.parkedAt) {
      const where = (S.phase === 'out') ? 'On the way to the loop' : (S.phase === 'loop' ? (S.dir === 'ccw' ? 'Scenic Loop, Scoria Point first' : 'Scenic Loop, Peaceful Valley first') : 'Heading back to Medora');
      if (S.onSpur) $('place-meta').textContent = 'Side road';
      else $('place-meta').textContent = where;
    }
    this.map(nx && nx.st);
    // progress ribbon
    const frac = Math.max(0, Math.min(1, S.tp / S.tour.route.total));
    $('ribbon-fill').style.width = (frac * 100) + '%'; $('ribbon-car').style.left = `calc(${frac * 100}% - 2px)`;
  },
  mapInit() {
    const T = S.tour, all = T.route.coords.concat(...Object.values(T.spurs).map(s => s.coords));
    const lat0 = T.route.coords[0][1];
    const xy = (c) => lonlatToXY(c[0], c[1], lat0);
    const P = all.map(xy), xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const sc = 92 / Math.max(maxx - minx, maxy - miny), ox = (100 - (maxx - minx) * sc) / 2, oy = (100 - (maxy - miny) * sc) / 2;
    const f = (c) => { const [x, y] = xy(c); return [(ox + (x - minx) * sc).toFixed(2), (oy + (maxy - y) * sc).toFixed(2)]; };
    S.mapF = f;
    const path = (cs) => 'M' + cs.map(f).map(p => p.join(',')).join('L');
    let svg = `<path class="r" d="${path(T.route.coords)}"/>`;
    for (const sp of Object.values(T.spurs)) svg += `<path class="spur" d="${path(sp.coords)}"/>`;
    svg += `<path class="r-done" id="map-done" d=""/>`;
    for (const st of T.stops) {
      if (st.kind === 'nav') continue;
      const [x, y] = f([st.lon, st.lat]);
      svg += `<circle class="st ${st.kind === 'pulloff' || st.kind === 'spurend' ? 'pull' : ''}" data-id="${st.id}" cx="${x}" cy="${y}" r="${st.kind === 'pulloff' || st.kind === 'spurend' ? 1.9 : 1.2}"/>`;
    }
    const [mx, my] = f([-103.5262, 46.9165]);
    svg += `<text x="${+mx + 3}" y="${+my + 1}">Medora</text>`;
    svg += `<g id="map-me"><path class="me" d="M0,-3.2 L2.3,2.6 L0,1.4 L-2.3,2.6Z"/></g>`;
    $('map').innerHTML = svg;
  },
  map(nextSt) {
    if (!S.pos || !S.mapF) return;
    const [x, y] = S.mapF(S.pos);
    let hdg = S.heading || 0;
    if (!S.onSpur) { const pa = pointAt(S.track, S.mi); hdg = pa[2]; if ((S.phase === 'loop' && S.dir === 'ccw') || S.phase === 'in') hdg += 180; }
    $('map-me').setAttribute('transform', `translate(${x},${y}) rotate(${hdg.toFixed(0)})`);
    document.querySelectorAll('#map .st').forEach(c => {
      const st = S.tour.stops.find(s => s.id === c.dataset.id);
      c.classList.toggle('next', !!nextSt && st.id === nextSt.id);
      c.classList.toggle('done', (st.approach && S.played.has(st.approach)) || (st.parked && S.played.has(st.parked)));
    });
  },
  ribbonTicks() {
    const T = S.tour, tot = T.route.total, html = [];
    for (const st of T.stops) { if (st.kind !== 'pulloff') continue; const tp = stopTp(st); if (tp == null) continue; html.push(`<i style="left:${(tp / tot * 100).toFixed(2)}%"></i>`); }
    $('ribbon-ticks').innerHTML = html.join('');
  },
  parked(st) {
    $('parked').hidden = false;
    $('parked-title').textContent = st.name;
    const tabs = [];
    if (st.onfoot) tabs.push(['On foot', () => `<p>${st.onfoot}</p>${st.restroom ? '<p>Restrooms here.</p>' : ''}${st.id === 'visitor-center' ? '' : '<p>Stay at least 25 yards from all wildlife. If an animal moves away from you, you are too close.</p>'}`]);
    if (st.visual === 'strata') tabs.push(['Rock layers', vizStrata]);
    if (st.visual === 'timeline') tabs.push(['Roosevelt here', vizTimeline]);
    if (st.quiz && st.quiz.length) tabs.push(['Quiz', () => quizHtml(st.quiz)]);
    tabs.push(['Photos', () => photosHtml(st.photos && st.photos.length ? st.photos : S.photos)]);
    tabs.push(['Animal sounds', soundsHtml]);
    tabs.push(['Safe distance', vizThumb]);
    tabs.push(['Wildlife count', tallyHtml]);
    const nav = $('tabs'); nav.innerHTML = '';
    tabs.forEach(([label, fn], i) => {
      const b = document.createElement('button'); b.textContent = label; b.setAttribute('role', 'tab');
      b.onclick = () => { nav.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', 'false')); b.setAttribute('aria-selected', 'true'); $('tab-body').innerHTML = fn(); wireTab(); };
      nav.appendChild(b); if (i === 0) b.click();
    });
  },
  unparked() { $('parked').hidden = true; },
  walking(on) { document.body.classList.toggle('walking', on); const n = $('parked-walk'); if (n) n.hidden = !on; },
};
function fmtMi(d) { return d < 0.1 ? 'here' : d < 10 ? d.toFixed(1) + ' mi' : Math.round(d) + ' mi'; }

// ------------------------------------------------------------------ parked-panel content
function quizHtml(qs) {
  return qs.map((q, qi) => `<div class="quiz" data-q="${qi}"><p>${q.q}</p>${q.a.map((a, ai) => `<button data-a="${ai}" data-c="${q.c}">${a}</button>`).join('')}<div class="why" hidden>${q.why}</div></div>`).join('');
}
function photosHtml(list) {
  return `<div class="thumbs">${list.map(n => { const c = S.tour.photos[n] || {}; return `<button data-photo="${n}"><img loading="lazy" src="media/photos/${n}.jpg" alt="${c.title || ''}" style="object-fit:${c.fit === 'contain' ? 'contain' : 'cover'};object-position:${c.focus || '50% 50%'}"></button>`; }).join('')}</div>`;
}
function soundsHtml() {
  return `<p>Real recordings. Turn it up.</p><div class="sounds">${S.tour.soundboard.map(s => `<button data-sound="${s.sound}">${s.label}</button>`).join('')}</div>`;
}
function tallyHtml() {
  const rows = S.tour.wildlife.filter(w => w.id !== 'traffic').map(w => `<span>${w.label}</span><b>${S.tally[w.id] || 0}</b>`).join('');
  return `<p>Every time you tell us what you’re seeing, it counts here. Wes is keeping track of the bison.</p><div class="tally">${rows}</div>`;
}
function wireTab() {
  const body = $('tab-body');
  body.querySelectorAll('.quiz button').forEach(b => b.onclick = () => {
    const box = b.closest('.quiz'); if (box.dataset.done) return; box.dataset.done = 1;
    const right = b.dataset.a === b.dataset.c;
    b.classList.add(right ? 'right' : 'wrong');
    box.querySelector(`button[data-a="${b.dataset.c}"]`).classList.add('right');
    box.querySelector('.why').hidden = false;
  });
  body.querySelectorAll('[data-sound]').forEach(b => b.onclick = () => {
    body.querySelectorAll('[data-sound]').forEach(x => x.classList.remove('playing'));
    b.classList.add('playing'); playSfx(S.tour.sounds[b.dataset.sound].file, () => b.classList.remove('playing'));
  });
  body.querySelectorAll('[data-photo]').forEach(b => b.onclick = () => { S.photos = [b.dataset.photo]; S.photoIdx = 0; S.photosKey = ''; render.showPhoto(); });
}
function vizStrata() {
  // simplified cross-section of a South Unit butte (not to scale)
  return `<div class="viz"><svg viewBox="0 0 320 210" role="img" aria-label="Cross-section of a badlands butte">
  <path d="M0 200 L40 200 L70 120 L95 100 L120 60 L200 60 L225 100 L255 120 L280 200 L320 200 Z" fill="#3A3F43"/>
  <clipPath id="b"><path d="M0 200 L40 200 L70 120 L95 100 L120 60 L200 60 L225 100 L255 120 L280 200 L320 200 Z"/></clipPath>
  <g clip-path="url(#b)">
   <rect y="60" width="320" height="10" fill="#E7805D"/>
   <rect y="70" width="320" height="38" fill="#99ADC5"/>
   <rect y="108" width="320" height="6" fill="#25282A"/>
   <rect y="114" width="320" height="10" fill="#E7805D"/>
   <rect y="124" width="320" height="40" fill="#C9AE83"/>
   <rect y="164" width="320" height="5" fill="#25282A"/>
   <rect y="169" width="320" height="31" fill="#D1CCBD"/>
  </g>
  <g font-size="11"><text x="206" y="58">Clinker cap (“scoria”)</text><text x="4" y="92">Sentinel Butte layers</text><text x="4" y="104" font-size="9" opacity=".8">gray and brown</text>
  <text x="252" y="113">Lignite coal</text><text x="4" y="148">Bullion Creek layers</text><text x="4" y="160" font-size="9" opacity=".8">yellow and tan</text></g>
  </svg><p>Mud, sand and volcanic ash washed off the young Rocky Mountains about 55 to 60 million years ago. Swamp plants became lignite. Where coal burned, the clay above baked into hard red clinker that caps the buttes and slows erosion.</p></div>`;
}
function vizTimeline() {
  const ev = [['1883', 'September: arrives at Little Missouri station at about 3 a.m. Hunts bison, buys into the Maltese Cross ranch.'],
    ['1884', 'February 14: his mother and his wife die on the same day. In June he returns to the Badlands. Starts the Elkhorn Ranch.'],
    ['1886', 'Captures three boat thieves on the Little Missouri as a deputy sheriff.'],
    ['1886–87', 'A brutal winter. NPS says he lost about 60 percent of his cattle.'],
    ['1898', 'Sells the Elkhorn.'],
    ['1947', 'Theodore Roosevelt National Memorial Park is created.'],
    ['1978', 'It becomes Theodore Roosevelt National Park.']];
  return `<div class="viz">${ev.map(([y, t]) => `<h4>${y}</h4><p>${t}</p>`).join('')}</div>`;
}
function vizThumb() {
  return `<h3>The thumb rule</h3><div class="viz"><svg viewBox="0 0 300 120" role="img" aria-label="Hold your thumb at arm's length; if it covers the animal you are far enough away">
  <rect x="0" y="0" width="300" height="120" fill="#2F3336"/><text x="12" y="24" font-size="14">Hold your arm out, thumb up.</text>
  <text x="12" y="44" font-size="14">If your thumb covers the whole animal,</text><text x="12" y="62" font-size="14">you’re far enough away.</text>
  <rect x="230" y="40" width="22" height="60" rx="10" fill="#D1CCBD"/><ellipse cx="241" cy="66" rx="9" ry="6" fill="#25282A"/></svg>
  <p>At least 25 yards — about two school buses — from all wildlife in Theodore Roosevelt National Park. More is better.</p></div>`;
}
function vizBison() {
  return `<div class="viz"><svg viewBox="0 0 300 140"><text x="10" y="20" font-size="13">Bison, then and now (NPS)</text>
  <rect x="10" y="34" width="280" height="20" fill="#99ADC5"/><text x="14" y="49" font-size="11" fill="#25282A">Before 1800s: tens of millions</text>
  <rect x="10" y="64" width="3" height="20" fill="#E7805D"/><text x="18" y="79" font-size="11">About 1900: roughly 300</text>
  <rect x="10" y="94" width="3" height="20" fill="#87BB41"/><text x="18" y="109" font-size="11">1956: 29 bison arrive here from Nebraska</text></svg></div>`;
}
function creditsHtml() {
  const T = S.tour;
  const ph = Object.entries(T.photos).map(([n, c]) => `<li><b>${c.title || n}</b> — ${c.credit || ''}. ${c.license || ''}. <a href="${c.url}" target="_blank" rel="noopener">Source</a></li>`).join('');
  const so = Object.values(T.sounds).map(c => `<li><b>${c.title}</b> — ${c.credit || ''}. ${c.license || ''}. <a href="${c.url}" target="_blank" rel="noopener">Source</a></li>`).join('');
  const tv = Object.values(T.trv).map(c => `<li>${c.credit}</li>`).join('');
  return `<h3>Credits</h3><p>Script and production: Theodore Roosevelt Presidential Library. Narration voices are AI-generated. Roosevelt quotations are verbatim from his published writings; sources are listed in the tour script.</p><h3>Roosevelt's voice</h3><ul>${tv}</ul><h3>Photos</h3><ul>${ph}</ul><h3>Sounds</h3><ul>${so}</ul><p>Route data © OpenStreetMap contributors (ODbL).</p>`;
}
function showDialog(html) { $('dlg-body').innerHTML = html; const d = $('dlg'); if (!d.open) d.showModal(); }

// ------------------------------------------------------------------ offline download
async function download(btn) {
  const T = S.tour;
  const files = new Set(['./', 'index.html', 'css/app.css', 'js/app.js', 'data/tour.json', 'fonts/fonts.css', 'fonts/Oswald-normal.woff2', 'fonts/SourceSerif4-normal.woff2', 'fonts/SourceSerif4-italic.woff2', 'manifest.webmanifest', 'icons/icon-192.png']);
  Object.keys(T.photos).forEach(n => files.add('media/photos/' + n + '.jpg'));
  Object.values(T.sounds).forEach(s => files.add(s.file));
  Object.values(T.trv).forEach(s => files.add(s.file));
  Object.values(T.clips).forEach(c => { if (c.audio && c.audio.file) files.add(c.audio.file); });
  const bar = document.querySelector('.dl-bar'), fill = bar.querySelector('i'); bar.hidden = false; btn.disabled = true;
  try {
    const cache = await caches.open('trnp-tour-v' + T.version);
    let done = 0; const list = [...files];
    for (const f of list) {
      try { const hit = await cache.match(f); if (!hit) await cache.add(f); } catch (e) { console.warn('could not cache', f); }
      done++; fill.style.width = (done / list.length * 100) + '%';
    }
    btn.textContent = 'Downloaded'; try { localStorage.setItem('trnp-dl', T.version); } catch (e) {}
  } catch (e) { btn.disabled = false; btn.textContent = 'Try again'; }
}

// ------------------------------------------------------------------ boot
async function boot() {
  const res = await fetch('data/tour.json'); S.tour = await res.json();
  const R = S.tour.route;
  S.track = makeTrack(R.coords, R.cum);
  S.spurs = {}; for (const [k, sp] of Object.entries(S.tour.spurs)) S.spurs[k] = makeTrack(sp.coords, sp.cum);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { if (localStorage.getItem('trnp-dl') == S.tour.version) { $('btn-download').textContent = 'Downloaded'; } } catch (e) {}

  // picker buttons
  $('picker-grid').innerHTML = S.tour.wildlife.map(w => {
    const img = (S.tour.clips[w.clip].images || [])[0];
    return `<button data-w="${w.id}" style="${img ? `background-image:url(media/photos/${img}.jpg);background-position:${(S.tour.photos[img] || {}).focus || '50% 50%'}` : ''}"><span>${w.label}</span></button>`;
  }).join('');
  $('picker-grid').onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) pickAnimal(S.tour.wildlife.find(w => w.id === b.dataset.w)); };
  $('picker-close').onclick = closePicker;
  $('btn-download').onclick = (e) => download(e.currentTarget);
  $('btn-start').onclick = () => begin('gps');
  $('btn-preview').onclick = () => begin('sim');
  $('link-credits').onclick = (e) => { e.preventDefault(); showDialog(creditsHtml()); };
  $('parked-close').onclick = () => { $('parked').hidden = true; };
  $('photo-credit').onclick = () => { const n = S.photos[S.photoIdx], c = S.tour.photos[n] || {}; showDialog(`<h3>${c.title || ''}</h3>${c.date ? `<p>${c.date}</p>` : ''}<p class="fine">${c.credit || ''}. ${c.license || ''}.</p><p><a href="${c.url}" target="_blank" rel="noopener">Source</a></p>`); };
  $('btn-pause').onclick = () => {
    S.userPaused = !S.userPaused; $('btn-pause').textContent = S.userPaused ? '▶' : '❚❚';
    $('btn-pause').setAttribute('aria-label', S.userPaused ? 'Resume narration' : 'Pause narration');
    if (S.userPaused) { const j = stopCurrent(true); if (j) S.paused = j; } else pump();
  };
  $('btn-menu').onclick = () => { $('menu').hidden = false; };
  $('menu').onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) { if (e.target.id === 'menu') $('menu').hidden = true; return; }
    const act = b.dataset.act; $('menu').hidden = true;
    if (act === 'wildlife') openPicker(true);
    if (act === 'replay' && S.lastClip) { stopCurrent(); S.played.delete(S.lastClip); playClip(S.lastClip); }
    if (act === 'skip') { stopCurrent(); S.paused = null; S.lastEnd = now(); }
    if (act === 'tally') showDialog('<h3>Wildlife count</h3>' + tallyHtml());
    if (act === 'credits') showDialog(creditsHtml());
    if (act === 'end') { stopCurrent(); if (!S.played.has('closing')) playClip('closing', { priority: 9 }); }
    if (act === 'sim-restart') { S.played.clear(); S.skipped.clear(); S.queue = []; stopCurrent(); startSim(); }
  };
  // deep link for testing: ?preview=1&dir=ccw&rate=8
  const q = new URLSearchParams(location.search);
  if (q.get('dir')) $('sim-dir').value = q.get('dir');
  if (q.get('wild') === '0') $('sim-wild').checked = false;
  if (q.get('speeder')) $('sim-speeder').checked = true;
  if (q.get('rate')) $('sim-rate').value = q.get('rate');
  if (q.get('preview') || location.hash === '#preview') begin('sim');
}

function begin(mode) {
  S.mode = mode; S.started = true;
  $('start').hidden = true; $('dash').hidden = false;
  // unlock audio on this tap (iOS)
  audioEl.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//sQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
  audioEl.play().catch(() => {}); sfxEl.play().catch(() => {});
  if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(' '); speechSynthesis.speak(u); }
  keepAwake();
  render.mapInit(); render.ribbonTicks();
  render.setPhotos(S.tour.clips.welcome.images);
  $('place-name').textContent = 'The Scenic Loop';
  $('place-meta').textContent = 'South Unit Visitor Center';
  if (mode === 'sim') {
    $('sim-badge').hidden = false; $('sim-ctl').hidden = false;
    const [lon, lat] = S.tour.route.coords[0]; S.pos = [lon, lat];
    playClip('welcome', { priority: 9, onDone: () => { startSim(); } });
  } else {
    startGps();
    playClip('welcome', { priority: 9, onDone: () => { if (S.speed <= CFG.parkSpeed) { const h = nearestStop(); if (h && h.st.id === 'visitor-center' && h.dist < 400) enqueue('vc-cabin', 4); } } });
  }
  setInterval(() => { if (S.mode === 'gps' && S.pos) tick(); else pump(); }, 1000);
}

boot();
if (TEST) { window.__render = render; window.__S = S; }
})();
