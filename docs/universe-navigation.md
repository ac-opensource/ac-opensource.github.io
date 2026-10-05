# Universe navigation

Every public route is a place in one shared universe, and following a link is a camera flight between two of those places. The page you leave collapses into the object it is about, the camera rises and crosses the sky past the other routes, then dives into the destination's object until that object opens out into the next page.

The controller is `assets/js/universe-theme-transition.js`; staging rules for the view-transition pseudo-elements live in `assets/css/universe-perspective-navigation.css`.

## World

`DESTINATIONS` in the controller places each route on one plane in shared world units:

| Route | Landmark | Hero it stands for |
| --- | --- | --- |
| `/` | orbital system | `[data-camera-window]` |
| `/about.html` | butterfly nebula | `#profile-map` |
| `/work.html` | supernova | `.work-hero__art` |
| `/blog/` | spiral galaxy | `#galaxy-field` |
| `/blog/*.html` | a star on one of the galaxy's arms (stable per path) | `.article-region__hero` |
| `/contact.html` | probe orbiting near home | `[data-payload-visual]` |
| `/resume.html` | career constellation | `[data-resume-signature-visual]` |
| `/signals.html` | radio beacon | `.signals-hero__telemetry` |
| `/search.html` | survey ring around the whole map | `.evidence-search__console` |

Bearings follow the floating sky map, so a flight heads where the map points. A landmark's `r` is the radius its hero occupies in the world; scale relationships come from those radii, so the archive galaxy dwarfs an entry, and Search looks down on everything.

## Flight

1. **Page cameras.** A page is viewed by the camera that puts its landmark under the page's measured hero, at the hero's size (`pageCamera`). The departing page measures its hero at click time; the arriving page measures its own once it has laid out.
2. **Path.** The camera follows the van Wijk & Nuij smooth zoom-and-pan path (`zoomPath`). Nearby hops stay low; distant ones rise until both objects share the view. Duration scales with the path's length, between 950 and 1600 ms.
3. **Pages in the world.** Both page images ride the same camera: transform from the camera, plus a lens mask around the hero that closes as the camera leaves a page and opens as it arrives. The lens also feathers the page rectangle, so no straight edge ever crosses the sky. A page larger than the view is only shown when the flight is nested inside it, as when opening a log entry from the archive.
4. **Sky.** Two canvases render the world between the pages. The far layer, beneath the pages, holds the sky colour, haze, 3D star octaves, chart lines, landmarks and the route. The near layer, above them, holds streaking foreground stars, field-stop rings around page lenses, and the destination reticle. Stars live in 3D between the camera and the page plane, so parallax and warp streaks come from real perspective at every scale.
5. **Light.** Each page keeps its own surface. Longer hops rise into a deeper twilight, light pages draw landmarks as ink line art, and dark skies draw them as luminous objects.

## Lifecycle

- **Click** (capture phase): plans the flight, stores it in `sessionStorage` (`ac.universe-perspective.v1`), and starts the iris: sky closes in at the page's edges while the next document is fetched. Same-origin links are prefetched on hover via speculation rules.
- **`pageswap`**: records the iris state for the arriving page. Back, forward, and route-signal links never pass the click handler, so the leaving page writes their flight plan here.
- **`pagereveal`** on the new page: creates the sky layers, sets `data-universe-flight`, and drives the old and new root images with the Web Animations API once the transition is ready. If the document is still parsing, the opening frame holds (up to 420 ms) so start-up scripts do not stall the flight. Any pointer, key or wheel input fast-forwards the landing.
- **Without cross-document view transitions**, the departing page flies the first part over itself and hands off in open space; the arriving page continues the same flight over itself.
- **Reduced motion** opts out of view transitions entirely and keeps native navigation.

Pages that defer their own intro motion keep the existing contract: `data-universe-motion="arrive"` is set before page scripts run, and `universe-perspective:settled` fires when the camera has landed.

## Adding a route

Add an entry to `DESTINATIONS` with a landmark (`x`, `y`, `r`, `kind`, `tag`) and the selector of the page's hero, map its path in `destinationForLocation`, and, for a new landmark `kind`, add a sprite recipe to `SPRITES` and line art to `drawLineArt`. Keep bearings consistent with `assets/js/universe-field-map.js`.

## Tests

- `npm run test:runtime` checks the navigation lifecycle and the pure flight model: path endpoints, durations, nesting, and landing exactly in place.
- `npm run test:flight:browser` flies real routes in Chromium with the arrival paused, sampling the start, middle and landing frames, then checks back navigation, reduced motion, and a phone viewport.
- `window.UniversePerspective.snapshot()` exposes the current landmark and focus, the last flight plan, and `flightStats` (frames, sky render cost, longest frame gap, hold time).
