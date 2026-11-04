# UI layout tests

Two headless checks that need no database — they serve `client/dist` together
with a mock API in a single process, so there is nothing to start or stop.

    cd client && npm run build
    cd ../tests/ui
    node sweep.mjs     # every route × mobile / tablet / desktop
    node probe.mjs     # mobile interaction states: drawer, dropdowns, modals

`sweep.mjs` flags horizontal overflow, controls outside the viewport, controls
under the 24px touch target, elements painted over by something else, blank
renders and console errors. Results land in `sweep.json`, screenshots in
`shots/`.

`probe.mjs` opens things the static sweep cannot see — the navigation drawer, a
row menu, the AI info popover, a modal, the appearance panel — and reports
whether each is on screen, on top, and unclipped. This is what caught the
Appearance panel rendering 94px off the right edge of a 390px screen.

Two caveats when reading the output:

* Sidebar links report as "offscreen" at `left=-228` when the drawer is closed.
  That is the drawer being off-canvas, which is correct.
* `mock-api.mjs` returns generic shapes, so some pages log `.map is not a
  function`. Those are the mock's shape, not product bugs — cross-check against
  the real API before chasing one.
