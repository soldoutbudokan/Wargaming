# Field Command

A standalone, offline browser strategy prototype inspired by historical battles. Version 0.2 adds terrain, fatigue, formation cohesion, period weapons, and visible volleys. Command formations in a cartographic battlefield, pause to plan, and watch a recording of your battle.

## Play

Open **index.html** in a modern browser. No installation, build step, account, server, or network connection is needed. The separate **field-command.html** distribution bundles the same game in one file.

1. Choose Cannae, Hastings, or Austerlitz.
2. Choose 1,000, 10,000, 25,000, 50,000, or 100,000 soldiers.
3. Select a formation on the field or in the bottom roster. Shift-click to select several; drag a box to select a group.
4. Click the field to move; click an enemy to attack. Begin the battle when ready.
5. Check fatigue, cohesion, ammunition, and terrain in the condition panel. Hold away from combat to rest, and protect ranged troops with clear firing lanes.
6. Use **View troops** for a close view; **Fit battlefield** returns to the tactical view. Pause at any time to plan, then review the recording with Replay.

| Control | Action |
| --- | --- |
| Space | Begin, pause, or resume; play/pause while in replay |
| A | Select all available friendly formations |
| H | Hold position |
| C | Charge nearest enemies |
| Escape | Clear selection |
| Mouse wheel, + / − | Zoom |
| Right/middle drag, arrow keys | Pan |
| ? | Open the field guide |
| Touch | Tap to select/order; drag to pan; use zoom buttons |

Selecting a new scenario, changing soldier count, or resetting clears the current battle and recording. Opening a dialog or leaving the tab pauses the battle. Replay preserves the live battle; return to it to continue. Replays last for the current page session and are not saved across reloads.

## What's implemented

- Three distinct deployments, named formations, historical notes with source links, and scenario-specific enemy behavior.
- Infantry, cavalry, bowmen/slingers, musket infantry, and artillery crews; movement, attack, charge, hold, line/column formations, and musket infantry squares.
- Deterministic combat, casualties, morale, fatigue, cohesion, retreat, flanking/rear attacks, and victory/defeat.
- Finite ammunition, reload cycles, facing arcs, firing lanes, arrows, musket volleys, and cannon effects.
- Rivers with fords, blocked ponds, route finding, woodland cover, mud, and elevation advantages.
- A selected-formation condition panel and close views with distinct soldier, horse, and gun silhouettes.
- Tactical pause, speed controls, group selection, camera zoom and pan, mobile layout.
- A replay timeline with interpolated movement, play/pause, scrubbing, and return to the live battle.
- Up to **100,000 individually drawn soldier marks**. At wide zoom, dense soldiers overlap; zoom in to distinguish them.

## Scope

This is a 2D prototype, not a full 3D Total War equivalent. The simulation runs **24 formations**, not 100,000 independent AI agents. Each living soldier has a render vertex. Cached WebGL point buffers draw all soldier marks; a cached Canvas renderer is available when WebGL cannot initialize. Frame rate depends on the browser and hardware; there is no universal 60 FPS guarantee.

Terrain remains a schematic interpretation rather than a surveyed historical map. Water blocks formation centers; troops use ford crossings, forests provide cover and obstruct sight, mud slows movement, and elevation affects combat. Formation footprints and soldier-level collisions are still simplified. There is no independent pathfinding for each soldier, 3D animation rig, campaign, multiplayer, or audio.

Historical locations, battle context, and tactical inspiration are real; army totals, unit mixes, positions, weapon ranges, reload times, fatigue rates, and casualty rates are adjusted for play. Ammunition is measured in formation volleys. Artillery soldier counts represent crews, not a count of guns. This is a game model, not a validated military or historical simulation.

Battles usually end when one side has no combat-capable formations. After ten simulated minutes, remaining combat strength decides the result (similar strengths produce a draw). Counts show surviving soldiers, including routed formations; retreat can therefore end a battle while many soldiers remain alive.

## Source layout

| File | Purpose |
| --- | --- |
| `index.html` | Application shell and dialogs |
| `style.css` | Responsive styling |
| `scenarios.js` | Scenario copy and historical source links |
| `terrain.js` | Shared geometry, navigation, cover, elevation, and sight |
| `engine.js` | Deterministic formation simulation |
| `renderer.js` | WebGL and Canvas rendering, terrain, camera |
| `app.js` | Controls, UI state, replay recording |
| `test-engine.cjs` | Simulation invariants and outcomes |
| `test-terrain.cjs` | Navigation, water barriers, cover, and sight checks |
| `test-renderer.cjs` | Native Canvas and WebGL draw-contract checks |
| `test-app.cjs` | DOM integration checks with a mocked renderer |
| `test-ui.cjs` | Optional Playwright integration checks |
| `build.py` | Build the single-file edition |

All gameplay assets are generated in code. No runtime dependencies or external asset requests. Historical source links open only when clicked.

## Verify or modify

With Node 24 or newer, install the development dependencies and run all non-browser checks:

```sh
npm install
npm test
```

Or run the simulation checks without dependencies:

```sh
node test-terrain.cjs
node test-engine.cjs
```

For interface integration checks, install JSDOM and run the DOM harness. It exercises the actual interface and simulation with a mocked renderer; it does not validate graphics or browser layout.

```sh
npm install --no-save jsdom
node test-app.cjs
```

To run browser checks, install Playwright and its Chromium browser in your development environment, then run:

```sh
npm install --no-save playwright
npx playwright install chromium
node test-ui.cjs
```

You can set `BROWSER_EXECUTABLE` to an existing Chromium executable. Browser tests write desktop/mobile preview PNGs beside the source. They cover soldier counts, WebGL errors, selection, orders, pause, replay, scenario changes, and mobile selection.

Build the single-file edition:

```sh
python3 build.py
```

## Historical references

- Cannae: [World History Encyclopedia](https://www.worldhistory.org/Battle_of_Cannae/); [Polybius, Histories, Book 3](https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Polybius/3%2A.html).
- Hastings: [Historic England battlefield listing](https://historicengland.org.uk/listing/the-list/list-entry/1000013).
- Austerlitz: [Fondation Napoléon](https://www.napoleon.org/en/magazine/places/austerlitz-2/).

Field Command is an original prototype and is not affiliated with Total War or Creative Assembly.
