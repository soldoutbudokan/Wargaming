# Verification record — version 0.2

Completed during creation:

- JavaScript syntax checks for the application, simulation, renderer, and scenarios.
- Simulation tests for exact 100,000-soldier allocation, period weapons, fatigue and rest, fatigue slowing movement, volleys, ammunition, reloads, firing arcs, friendly obstruction, cover, elevation, cavalry versus squares, deterministic outcomes, isolated snapshots, and completed battles.
- Terrain tests for ford detours, impassable water, blocked destinations, pond avoidance, ridge/forest sight, and 479 generated routes checked at one-unit intervals.
- DOM integration tests using JSDOM with the real application, terrain, and simulation and a mocked renderer. All ten groups pass: initialization, 100k reset, selection/orders/condition panel, water rejection and movement, simulation/pause/recording, replay/scrub/restart/return, running-state restoration, scenarios/period weapons/ammo/notes, small-screen pointer coordinates, and keyboard/camera controls.
- Native Canvas rendering and visual inspection of the updated terrain, formations, and close views. Renderer regression checks pass for shared terrain identity, exact 100k vertex/survivor counts, crew/gun identity, zoom and coordinate transforms, effects, casualty/replay state, and matching shader precision. These checks do not execute a GPU shader.

Scripted charge-all battles at the fixed 1/30-second simulation step ended naturally after approximately 179 seconds at Cannae, 271 seconds at Hastings, and 239 seconds at Austerlitz. These are test runs, not a prediction of every player's outcome.

The bundled Playwright browser integration suite remains **unverified**: Chromium could not start in this execution environment. Browser layout, real GPU shader execution, and device frame rate have not been confirmed. The Canvas pictures used during development are renderer checks, not browser screenshots. The passing DOM harness does not replace browser validation.

The simulation is intentionally simplified and does not establish historical fidelity or independently simulated soldier behavior.
