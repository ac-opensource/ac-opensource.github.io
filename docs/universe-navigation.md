# Universe navigation

Every public route is a place in one shared 3D universe, and following a link is a camera flight between two of those places. The page dissolves into its celestial environment, the camera turns and travels through space, then the destination's reading surface appears after the observer settles. Targets can be above, below, beside or behind the observer.

The controller is `assets/js/universe-theme-transition.js`; staging rules for the view-transition pseudo-elements live in `assets/css/universe-perspective-navigation.css`.

## World

`DESTINATIONS` in the controller places each route in shared X/Y/Z world units. X grows east, Y grows down and positive Z points toward the resting observer. Page views face -Z; their camera distance comes from the measured hero size.

| Route | Landmark | Hero it stands for |
| --- | --- | --- |
| `/` | six eccentric orbital tracks with shaded bodies | `[data-camera-window]` |
| `/about.html` | butterfly nebula | `#profile-map` |
| `/work.html` | elongated cobalt/copper supernova remnant | `.work-hero__art` |
| `/blog/` | spiral galaxy | `#galaxy-field` |
| `/blog/*.html` | a star on one of the galaxy's arms (stable per path) | `.article-region__hero` |
| `/contact.html` | foil-wrapped satellite with photovoltaic arrays and smooth dish | `[data-payload-visual]` |
| `/resume.html` | career constellation | `[data-resume-signature-visual]` |
| `/signals.html` | registry beacon with inclined rings | `.signals-hero__telemetry` |
| `/search.html` | three survey range gates around the map | `.evidence-search__console` |

The floating sky map remains an X/Y schematic. Depth changes the actual bearing from the current eye: About sits behind Home, Portfolio above it, Contact below it and Logs off to its right and farther away. A landmark's `r` is the radius its hero occupies in the world. Entries inherit their galaxy's Z coordinate and stable arm positions. Existing route `depth` and `magnification` metadata remain available to consumers; geometric depth comes from the landmark's Z coordinate and camera projection.

## Flight

1. **Page cameras.** A page is viewed by the camera that puts its landmark under the page's measured hero, at the hero's size (`pageCamera`). The departing page measures its hero at click time; the arriving page measures its own once it has laid out.
2. **Path.** `zoomPath` generalizes the van Wijk & Nuij zoom-and-pan distance to three dimensions. The `spatial-zoom-orbit` camera also yaws and pitches toward the destination's bearing, including a rearward turn when required, then aligns with the destination's reading view. Nested archive/entry journeys retain their direct dive. Duration accounts for distance and turn angle, bounded to 950–1900 ms; input can still fast-forward the landing.
3. **Reading surfaces.** Both page projections derive from the same observer as the sky, with near-plane and facing checks. They are exposed only at rest: the source dissolves during the first 10%, the camera flies from 10–82%, and the destination emerges during the final 18%. Visible text therefore retains its exact layout instead of becoming a tilted sheet. Landmark visibility uses the same exposure envelope, including the split-document fallback. Headers return late in the reveal.
4. **Sky.** Two canvases render the world between pages. The far layer holds sky colour, haze, volumetric star octaves, clipped chart lines and landmarks sorted by camera depth. The near layer holds restrained star streaks and the reticle. Stars occupy stable 3D cells in every direction; projecting each fixed star through the current and previous camera poses produces both rotation and translation parallax. A rear target receives an edge cue marked BEHIND until the turn brings it into view. The reticle reports camera-relative azimuth, elevation and range.
5. **Light.** Each page keeps its own surface. Longer hops rise into a deeper twilight. Shaded solids, translucent matter and ink tracks remain legible across both daylight and dark sky.

About uses `about-butterfly-field.js`, the same raymarched cloud and filament renderer as its live hero, with the flight's eye and rays in nebula coordinates. Rendering is cropped to the object's projected bounds and capped at 180,000 pixels. A world-projected particle shell preserves its shape and parallax when WebGL is unavailable or lost.

Logs uses shared `model.galaxyGeometry` arm winding and orbital phase. Every star occupies a world position and passes through the camera projection; no baked screen rotation or fixed galaxy billboard remains. `UniverseGalaxy.snapshot()` exposes the live core, responsive axes, elapsed phase and encounter state. Departure stores that snapshot and arrival measures it from the actual field. When the core is below the fold, navigation uses a centered focus instead of taking the flight offscreen. Its clock holds during navigation, retaining Pause, offscreen and reduced-motion behavior. A filtered encounter does not get replaced with a four-arm landmark. Article navigation retains stable per-path positions; these are schematic arm locations, not the live archive's index-based node positions.

The other landmarks use cached local XYZ geometry from `model.landmarkGeometry`, positioned by `model.landmarkWorldPoint`. `universe-solid-field.js` renders opaque faces and smooth bodies through the same camera with a depth buffer and clipped, translucent linework. Contact has a bevelled foil-wrapped bus, framed photovoltaic wings, hinges and rear trusses, radiator louvres, optical port, thrusters, a smooth paraboloid reflector and feed supports. Procedural materials remain anchored to the surfaces: crinkled thermal foil, machined metal, solar cells and fine conductors, ceramic and dark composite. Home and Production bodies have rock or gas-band surfaces and a directional terminator; luminous nodes and article stars retain their stellar identity. A fixed world light and restrained reflected fill keep shading coherent through a turn.

Each object's cached 3D bounds project to a tight screen crop. The material field is capped at 300,000 pixels and DPR 1.5; it uses cached geometry buffers and one reusable offscreen context. Halos and clouds remain world-projected underneath the opaque surfaces. An unavailable or lost WebGL context falls back to Canvas geometry with backface culling, near-plane clipping and depth ordering. The fallback preserves route geometry but does not reproduce the material shader. Home retains the live rig's six eccentric track profiles. Résumé is a milestone constellation based on the mission dossier; Signals is an empty registry instrument, with no invented public records. Search's large survey gates become faint when another destination is active, and fade during departure. Skills has two branching trunks, Production has two inclined groups of bodies, and articles have a restrained stellar corona.

Portfolio uses a separate remnant field in the bounded raymarcher: an irregular thick ellipsoid, blue/teal interior and copper filaments following the live artwork's diagonal silhouette. The default About field is unchanged. If WebGL is unavailable or lost, Portfolio uses its deterministic shell and filament geometry. These navigation objects borrow the pages' authored motifs without mounting page controllers or changing their functional state.

## Lifecycle

- **Click** (capture phase): plans the flight, stores it in `sessionStorage` (`ac.universe-perspective.v1`), and starts the iris: sky closes in at the page's edges while the next document is fetched. Same-origin links are prefetched on hover via speculation rules.
- **`pageswap`**: records the iris state for the arriving page. Back, forward, and route-signal links never pass the click handler, so the leaving page writes their flight plan here.
- **`pagereveal`** on the new page: creates the sky layers, sets `data-universe-flight`, and drives the old and new root images with the Web Animations API once the transition is ready. If the document is still parsing, the opening frame holds (up to 420 ms) so start-up scripts do not stall the flight. Any pointer, key or wheel input fast-forwards the landing.
- **Without cross-document view transitions**, the departing page flies the first part over itself and hands off in open space; the arriving page continues the same flight over itself.
- **Reduced motion** opts out of view transitions entirely and keeps native navigation.

Pages that defer their own intro motion keep the existing contract: `data-universe-motion="arrive"` is set before page scripts run, and `universe-perspective:settled` fires when the camera has landed.

## Adding a route

Add an entry to `DESTINATIONS` with a landmark (`x`, `y`, `z`, `r`, `kind`, `tag`) and its hero selector, map its path in `destinationForLocation`, and author local XYZ geometry for any new `kind`. Keep X/Y placement consistent with the schematic in `assets/js/universe-field-map.js`. Choose Z deliberately and check the route from both directions.

## Tests

- `npm run test:runtime` checks lifecycle, all public route pairs on desktop and phone, 3D directions, camera bases, near-plane-safe page projections, nested roundtrips and measured-focus correction. It also checks all nine geometric landmark kinds for finite stable geometry, meaningful depth, canonical world placement and clipped projected edges.
- `npm run test:flight:browser` flies real routes in Chromium, including a target initially behind the observer and About/Logs in both directions, and checks page exposure, exact landing matrices, live galaxy geometry, Back, reduced motion and phone navigation. It uses full Chromium headless mode so the real material shaders are checked for depth occlusion, cropped projection, transparency, near clipping, pixel limits and context loss. A separate unavailable-renderer flight checks the Canvas fallback.
- `window.UniversePerspective.snapshot()` exposes the current landmark/focus, the last plan (including `fromPosition`, `toPosition`, `turnYaw`, `turnPitch`, `targetBehind`), render/flight timing, and material/fallback rendering counters. Session handoffs use record version 11; older records are discarded.
