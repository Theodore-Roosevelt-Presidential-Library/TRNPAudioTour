# South Unit Scenic Loop Drive: research notes (compiled 2026-10-10)

Companion to `stops.json`. That file has 33 entries in clockwise road order: stops, junctions and spur turnoffs. Each entry has coordinates, a confidence level, source URLs, mileage in both directions, the side of the road, the walk required, facilities, and a description based on NPS text.

## Road layout
- **Stem (out and back):** About 6.4 mi on East River Road, from the South Unit Visitor Center in Medora to the loop junction at 46.95498, -103.51196, near the Peaceful Valley prairie dog town. The stem passes Medora Overlook (mi 0.3), Johnson's Plateau prairie dog town (3.2), Skyline Vista (4.1) and Cottonwood Campground (5.4).
- **Loop proper:** About 22.1 mi computed. AP calls it a "21-mile loop." NPS gives the whole drive as **36 miles**. Driving VC to the full loop and back to VC on OSM roads measures about 34.9 mi, plus the two spurs.
- **North junction:** At mi 10.6, just past Wind Canyon, gravel East River Road continues north out of the park.
- **Spurs:** Buck Hill Road is about 0.8 mi one way ("just under a mile," NPS). Its turnoff is at mi 18.2. Coal Vein Road is about 0.82 mi one way, unpaved ("compacted" per OSM), with its turnoff at mi 19.6. Peaceful Valley Ranch is about 0.3 mi off the road on a paved spur. Halliday Well Road is about 0.44 mi of gravel.
- **Direction:** NPS calls the road a "two-way paved loop" and does not recommend a direction. Park mile markers increase **clockwise**: the closure ran from MM 22 to 28, and the 2020 culvert failure at MM 12 was at Wind Canyon. My computed clockwise miles track the markers within a few tenths. "Clockwise" in the TRPL park guide is TRPL's own suggestion, not NPS guidance.
- **Rebuilt section (2022–25, about $51M from the Great American Outdoors Act):** Runs from the East River Road junction to the Old East Entrance pull-off, mile markers about 22–28. That covers Scoria Point, Ridgeline and Badlands Overlook. The loop reopened Nov. 23–25, 2025. Any NPS page that still says "24-mile out-and-back" (things-to-do pages from 2021) is out of date.

## Speed limits
- **NPS (car.htm, updated 11/28/2025):** "Unless otherwise posted, the speed limit through the park is 25 mph." Limits are posted and enforced.
- **OpenStreetMap tags only, not confirmed by NPS:**
  - 35 mph on the stem and the north/west branch (mi 0–10.6)
  - 25 mph on the east and south sides (mi 10.6–28.3)
  - 15 mph on Buck Hill Road
  - 25 mph on Coal Vein Road
- These tags match the expected 25/35 split, but check them before the narration quotes 35.

## Safety and rules (NPS)
- **Wildlife distance:** Keep at least **25 yards** from all wildlife. NPS describes this as about two bus lengths and applies it to bison, elk, deer, pronghorn and horses. NPS also suggests a "rule of thumb" check: hold out your thumb, and if it covers the animal you're far enough away. Bison rut runs mid-July through August.
- **Feeding:** Feeding any animal is prohibited. Prairie dogs can bite and can carry plague fleas.
- **Fees:** An entrance fee applies year-round: $30 per vehicle for 7 days, $25 per motorcycle, $15 per person. The park has been **cashless since May 1, 2026**.
- **Overnight:** No overnight stays along the road.
- **Services:** There are no services in the park.
- **Restrooms on the loop:**
  - Peaceful Valley Ranch
  - Halliday Well Trailhead
  - An accessible vault toilet near the Buck Hill road, about mi 19
  - Cottonwood Campground and the VC on the stem
- **Cell signal:** NPS tags cell signal only at Skyline Vista, Boicourt Overlook and Trail, Buck Hill, and the VC. Build the tour to work fully offline.
- **Pulling off:** I found no explicit NPS rule. Script "use the pullouts" as general advice, not as a regulation.

## Closures
- **Winter:** Parts of the drive "may be closed in winter due to snow and ice." No fixed dates or gate schedule are published. OSM shows a gate on the south branch at the junction, but its purpose isn't documented.
- **Current alerts (NPS alerts API, read 10/10/2026):** None of the active alerts is a road closure.
- **Ridgeline Nature Trail: open question.** NPS's South Unit page (updated May 17, 2026) and trlibrary.com both say it is "currently inaccessible due to road collapse." I found no 2026 news of a new collapse. The wording may be left over from the closure years. **Call the park (701-623-4466) before scripting Ridgeline.**

## Coordinate quality
- **High confidence:** NPS place records for 20+ stops, where they agree with OSM.
- **Medium confidence (OSM only):** Cottonwood, Lower Jones Creek and Halliday Well trailheads, the Buck Hill restroom, the entrance booth, and both junctions.
- **Low confidence:** Two unnamed OSM viewpoint pullouts on the rebuilt section.
- **Not found:**
  - **"North Dakota Badlands Overlook":** No separate record exists, so I treated it as Badlands Overlook (needs checking).
  - **"River Woodland Overlook":** Listed by NPS as a stop, but no coordinates are published. One possible match is the NPS audio-tour "conclusion" point near Cottonwood, which is not confirmed.

## Other findings
- NPS already runs its own **Scenic Loop Drive audio tour** in the NPS App, with place records for about 11 stops. TRPL's tour should complement it, not duplicate it.
- About 198 wild horses roam the South Unit. 2025–26 NPS GPS-collar data shows them often near Coal Vein, the Old East Entrance, Johnson's Plateau, the Wind Canyon junction, and around mile markers 12–13.
- Peaceful Valley Ranch **no longer offers guided rides**. NPS says so, so the TRPL park guide's reference to rides there is out of date.

## NPS text issues to check before scripting
- **Old East Entrance:** The NPS page says the CCC worked in the park "1934 to 1931," an obvious typo.
- **Boicourt:** NPS quotes TR's "a land of vast, silent spaces." Verify the exact wording and source.
- **Coal Vein:** The coal-fire dates (1951–1977) come from the TRPL guide, not from an NPS page I read.
- **Trail lengths:** NPS pages disagree (Skyline 0.1 vs 0.2, Boicourt 0.2 vs 0.3, Buck Hill 0.1 vs 0.2).
