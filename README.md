# TRNPAudioTour

**Scenic Loop with Nora & Wes**: a free, GPS-guided driving audio tour of the South Unit Scenic Loop in Theodore Roosevelt National Park, from the Theodore Roosevelt Presidential Library.

Live at `https://trnptour.labs.trlibrary.com` once Pages is turned on (see Deploy).

## What it does

- Starts at the South Unit Visitor Center in Medora and follows the drive out the stem, around the loop in **either direction**, and back to town.
- Keeps the screen on (Wake Lock) for a dash mount. Works fully offline after "Download the tour" (cell service in the park is spotty).
- Plays two-host audio (Nora and Wes) triggered by GPS. Stop clips start early enough to finish as you arrive; stories fill quiet stretches only when there is time to finish before the next stop.
- Shows photos, live captions, a route map, your speed against the posted limit, and the next stop with its side of the road.
- Speed pacing: the gauge goes yellow and then coral over the limit; up to three spoken nudges per drive.
- Pull-offs: when you park, the side panel opens with on-foot info, quizzes, rock-layer diagrams, photos, real animal sounds and the safe-distance rule. Interactive pieces only open when the car is stopped.
- Slowdowns: when you crawl away from a pull-off (wildlife or a bison jam), the screen asks "What are you seeing?" and plays a short clip for that animal. Picks count toward a wildlife tally.
- Side roads to Buck Hill and the Coal Vein, off-route and weak-GPS prompts, a U-turn detector, and an evening-only night-sky story.
- **Preview the drive from home**: a simulated drive with direction, speed-up, stops, wildlife slowdowns and a "drive too fast" option.

## Layout

```
app/                 the static site (deployed as-is)
  index.html         the tour
  script.html        script review page (every line, with audio and sources)
  js/app.js          GPS + trigger engine, player, UI, simulator (no dependencies)
  data/tour.json     generated: route, stops, clips, credits
  audio/             generated: one mp3 per clip
  media/             photos, animal sounds, Roosevelt's 1912 voice
script/tour-script.md  THE SCRIPT (edit this)
script/lines.json      generated: every voiced line with a content hash
audio-src/lines/       one mp3 per voiced line (Artlist, Eleven v3 model)
research/              fact sheet with sources, stop research, media licenses
tools/                 build and test scripts
```

## Editing the script

1. Edit `script/tour-script.md`. `N:` Nora, `W:` Wes, `Q:` a verbatim Roosevelt quote with `{source}`, `SFX:` an animal sound, `TRV:` Roosevelt's recorded voice. `src:` lines are citations and are never read aloud.
2. `python3 tools/lines.py` lists the lines that changed (only those need new audio).
3. Voice the changed lines in Artlist (Nora = voice "Resonance", Wes = "Keen", voice stability 0.4) and save each as `audio-src/lines/<file>` using the file name from `lines.json`. Claude can do this step through the Artlist connector.
4. `python3 tools/assemble.py` builds the clip mp3s (pass clip ids to rebuild only some).
5. `python3 tools/build_data.py research research` rebuilds `app/data/tour.json` (stops, photos, speed limits and quizzes are set at the top of that script).
6. `python3 tools/build_review.py` refreshes `app/script.html`.

Roosevelt quotes are read by Nora for now. To use Joe Wiegand's recordings, save each as the line file for that `Q:` line and re-run `assemble.py`.

## Testing

`python3 tools/sim_test.py http://localhost:8000 cw` (or `ccw`) drives the whole loop in fast mode with Playwright and prints what played where. Serve `app/` with `python3 -m http.server 8000 -d app`. In a browser, `index.html?preview=1&dir=ccw&rate=8` opens the preview directly.

## Deploy

GitHub Pages via Actions (`.github/workflows/pages.yml`) publishes `app/` on every push to `main`. One-time setup: repo Settings → Pages → Source: **GitHub Actions**, custom domain `trnptour.labs.trlibrary.com` (the `*.labs` wildcard DNS already points at GitHub Pages).

## Before launch

See the checklist at the top of `app/script.html`: Ridgeline Nature Trail status, the 35 mph segments (OpenStreetMap only; NPS default is 25), the 1884 diary loan, pronunciations, the Joe Wiegand quote session, the Artlist license for public use, and a heads-up to the park.

## Credits

Photos: NPS (public domain), Library of Congress, Wikimedia Commons (licenses and attribution in the app's credits screen and `research/manifest.json`). Animal sounds: NPS sound library and others, public domain or CC BY/BY-SA. Roosevelt's voice: 1912 Edison recording, public domain. Route © OpenStreetMap contributors (ODbL).
