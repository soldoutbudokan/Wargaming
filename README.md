# Wargaming — Field Command

[Play Field Command](https://soldoutbudokan.github.io/Wargaming/)

A browser battle game with Cannae, Hastings, and Austerlitz scenarios, up to 100,000 rendered soldiers, tactical pause, and replay. No installation or account is needed to play.

## Controls

- Select a formation on the field or in the bottom roster. Shift-click or drag a box to select more.
- Click open ground to move; click an enemy to attack.
- **Space** pauses or resumes; **A** selects all; **H** holds; **C** charges.
- Scroll to zoom. Right-drag, middle-drag, or the arrow keys pan.
- Choose **View troops** for a close view, or **Fit battlefield** to return.
- On touch screens, tap to select and command, drag to pan, and use the zoom buttons.

Terrain, fatigue, cohesion, ammunition, reloads, cavalry momentum, cover, and elevation affect combat. The simulation runs by formation; the individual soldier marks are rendered separately. Frame rate depends on your device.

## GitHub Pages

The repository root contains the complete game in `index.html`. The `.nojekyll` file tells GitHub Pages to serve the static files directly. Pages publishes the root of `main`; no custom workflow, server, environment variables, or build service is required.

The URL includes the project path `/Wargaming/`. The published file contains its own scripts and styles, so it does not depend on root-relative asset paths or third-party CDNs.

Changes to `main` trigger GitHub's **pages build and deployment** workflow. Check the repository's Actions tab for deployment results. If the publishing source is changed, restore **Settings → Pages → Deploy from a branch → main → /(root)**.

## Development

Editable source, scenario notes, and tests are in [`source/`](source/).

```sh
cd source
npm install
npm test
python3 build.py
```

`build.py` rebuilds the root `index.html`; commit that file with your source changes to publish them. Node 24+ is used for development tests; players only need a modern browser.

For a local preview, run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000/`. You can also open `index.html` directly offline.

## Scope

This is a 2D strategy prototype with simplified historical scenarios. Armies, terrain, ranges, reloads, and casualties are adjusted for play. It does not simulate 100,000 independent AI agents or reproduce surveyed historical battlefields.
