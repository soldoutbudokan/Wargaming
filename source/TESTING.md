# Verification record — version 0.2

Completed during creation:

- JavaScript syntax checks for the application, simulation, renderer, and scenarios.
- Simulation tests for exact 100,000-soldier allocation, period weapons, fatigue and rest, fatigue slowing movement, volleys, ammunition, reloads, firing arcs, friendly obstruction, cover, elevation, cavalry versus squares, deterministic outcomes, isolated snapshots, and completed battles.
- Terrain tests for ford detours, impassable water, blocked destinations, pond avoidance, ridge/forest sight, and 479 generated routes checked at one-unit intervals.
- DOM integration tests using JSDOM with the real application, terrain, and simulation and a mocked renderer. All ten groups pass: initialization, 100k reset, selection/orders/condition panel, water rejection and movement, simulation/pause/recording, replay/scrub/restart/return, running-state restoration, scenarios/period weapons/ammo/notes, small-screen pointer coordinates, and keyboard/camera controls.
- Native Canvas rendering and visual inspection of the updated terrain, formations, and close views. Renderer regression checks pass for shared terrain identity, exact 100k vertex/survivor counts, crew/gun identity, zoom and coordinate transforms, effects, casualty/replay state, and matching shader precision. These checks do not execute a GPU shader.

Scripted charge-all battles at the fixed 1/30-second simulation step ended naturally after approximately 179 seconds at Cannae, 271 seconds at Hastings, and 239 seconds at Austerlitz. These are test runs, not a prediction of every player's outcome.

The bundled Playwright browser integration suite remains **unverified**: Chromium could not start in the original local execution environment. The Canvas pictures used during development were renderer checks, not browser screenshots. The passing DOM harness does not replace browser validation.

## GitHub Pages live browser verification — 2026-09-26

The published game at https://soldoutbudokan.github.io/Wargaming/ was manually exercised in a separate Chromium browser after GitHub Pages reported a successful deployment. The root page loads with its inline styles and scripts. Verified the 100,000-soldier setting, formation selection, map movement orders, charge orders, battle progression with casualties and changing morale/fatigue, tactical pause, troop inspection and camera fit, recorded replay and return to battle, and all three scenario loads. Desktop layout and battlefield rendering were inspected in actual browser screenshots.

This browser used the Canvas fallback. Its displayed frame-rate counter was approximately 59–60 FPS during the tested Cannae battle, which is an observation for this environment, not a performance guarantee. Real GPU shader execution, other browsers, mobile layout, and performance on player devices remain unverified. All four local regression suites passed again against the staged Pages source. This manual smoke test does not imply that the separate Playwright suite ran.

The simulation is intentionally simplified and does not establish historical fidelity or independently simulated soldier behavior.
