# Kigumi · 木組み

A peaceful, Age of Empires-inspired village builder in a small Japanese countryside diorama. Three.js renders the world; Tauri packages it as an offline desktop game. No accounts, servers, telemetry, downloaded assets, or LLMs are required to play.

## Play and develop

Requires Node.js 22.12+ (Node 24 recommended) and pnpm 11.9.0 (pinned in `package.json`). The desktop build also needs Rust and the platform's [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install --frozen-lockfile
pnpm run dev          # browser development at http://127.0.0.1:1420
pnpm run desktop      # native development window
pnpm test             # deterministic simulation and save tests
pnpm run build        # TypeScript + production frontend
pnpm run desktop:build
```

Dependencies must be installed online once; the built app runs fully offline. Installers/bundles are written under `src-tauri/target/release/bundle/`. On this development machine, a debug macOS app is also available at `src-tauri/target/debug/bundle/macos/Kigumi.app`. macOS has been built and manually play-tested. Windows and Linux share the Tauri configuration and have CI build jobs, but have not been run locally.

## The first village

You begin with ten villagers, a hall, two homes, a storehouse, and a rice paddy. Explore at your own pace. There is no combat, death, timer, or victory condition.

- Select a villager with **left click**, or **drag a box** to select a group. **Shift** adds villagers to a selection.
- **Right-click** a tree, berry bush, or stone deposit to gather; an unfinished building to construct; a paddy or workshop to work; or open ground to move.
- Workers carry real loads to a reachable hall or storehouse. Nearby storage reduces travel, and paths make walking **45% faster**. A route must remain open to each building and villager when placing a structure.
- Rice farmers stand inside their paddy while tending it, then walk out to deliver food or follow a new order. Up to three farmers reserve separate work spots.
- Choose a building from the bottom bar, then click a valid grid footprint. **R** or the **Rotate 90°** button cycles through South, East, North and West; the placement hint shows the facing and footprint. **Escape** or right-click cancels. Repeated placements keep their direction; choosing another building or re-entering placement starts facing South. Selected villagers build, or two nearby auto-workers are assigned automatically.
- Drag to place paths or bridge tiles. **Lift a path** removes paths; bridge removal checks that nobody is stranded. Buildings can be dismantled from their inspector for half their material cost.
- Homes add six places, or eight after Timber joinery. **Welcome a villager** costs 35 food and takes twelve simulation seconds. Queue up to 20 villagers (including the active welcome); each order pays once and reserves a housing/population place. The default global cap is **200**, adjustable from 10 to 500 in Settings; 500 is an experimental setting, not a performance target.
- Auto-work finds new tasks after construction or resource depletion. Explicit movement ends in standing by. The inspector can toggle auto-work, stop a worker, or ask them to find work again.
- Five technologies unlock workshops, tea houses and shrines, improve carrying capacity, cultivation and craft. Workshops need assigned workers to produce insight; the hall produces it slowly on its own.
- Food consumption is gentle and never kills residents. Proximity creates acquaintances, friendships and occasional friction. Amenities lift nearby morale and strengthen warm encounters. Town management comes first.

| Control                      | Action                    |
| ---------------------------- | ------------------------- |
| WASD / arrows                | Pan                       |
| Q / E or middle-button drag  | Orbit                     |
| R (while placing a building) | Rotate building 90°       |
| Scroll                       | Zoom at cursor            |
| Minimap click / drag         | Center / pan camera       |
| Home                         | Center camera             |
| Tap Space                    | Pause/resume              |
| Space + left-button drag     | Pan by dragging the world |
| 1 / 2 / 4                    | Simulation speed          |
| G                            | Toggle grid               |
| B                            | Toggle build panel        |
| H                            | Hide/show interface       |
| I                            | Select idle villagers     |
| Ctrl / Cmd + S               | Manual save               |
| ?                            | Field guide               |

Hold **Space** for a hand cursor, then left-drag to pan (including in build mode). Release Space or the mouse to stop panning; a pan never toggles pause. Escape or switching away cancels the gesture. Space keeps its normal behavior in focused buttons and text fields. Scroll zooms toward or away from the ground under your cursor; at the map boundary, camera limits take priority. Click or drag the minimap to move the camera continuously.

Panel headings collapse the build palette, map, progress, and selection details. Build, map, and progress panel preferences are remembered on this device. Selection details appear when you select an object; click the population count for the village overview. **H** hides the interface while keeping a restore button visible.

Select the village hall to see the active villager welcome and its ordered waiting list, alongside independent village-wide research. Both active activities show a progress bar and percentage. Paused activities and blocked arrivals are labeled. If housing or population capacity falls, or hall access is blocked, paid orders wait safely; the next welcome starts only after the current villager arrives. Research supports one project at a time. Paddies and workshops produce continuously and do not have item queues.

Menus and hidden windows pause simulation. The village does not simulate while closed. Days are a display clock; seasons and a day/night gameplay cycle are not implemented.

## Saves

Active welcome progress and paid waiting orders are saved together. Older v1 saves with only an active welcome load with no waiting orders and keep their already-paid progress.

Autosaves run every 30 seconds and on hide/close. The manual slot is separate. Saves live in the browser/WebView's local storage on this device; the browser development version and native app have separate storage. Export/import JSON copies from Settings to move a village between devices. Loading validates the format, version, entities, commands, bounds, and numerical state before rendering. Building orientation is saved with the village. Existing v1 saves still load; older game builds cannot read saves containing the new North/West orientations. Failed local writes show a warning. Back up important villages with an export; clearing application data removes local saves.

## Structure and extension points

- `src/simulation/catalog.ts` — buildings, footprints, costs, research dependencies and tuning.
- `src/simulation/types.ts` — serializable world, orders and command protocol.
- `src/simulation/engine.ts` — fixed 250 ms deterministic ticks, resource hauling, construction, research, population and proximity relationships. Seeded randomness; no DOM, Three.js, network, database or wall-clock dependency.
- `src/simulation/grid.ts` — occupancy cache, A* routes, road travel weights, perimeter access.
- `src/simulation/session.ts` — authority interface and local implementation. Command and snapshot envelopes are the future multiplayer seam. A real remote authority, authentication, transport, sequencing, reconciliation and synchronization remain to be built.
- `src/simulation/save.ts` — versioned local and portable saves.
- `src/game/` — procedural models, terrain, camera, picking, visual interpolation and local building thumbnails.
- `src/main.ts` / `src/style.css` — desktop game interface and controls.
- `src-tauri/` — native shell with embedded frontend and a restrictive production CSP.

`World.scenario` currently carries the freeform identifier and milestone flags. Add scenario definitions and objective evaluation above the same command/tick engine; there is no scenario editor or scripted scenario runner yet. The seed varies resource placement and tree appearances on a fixed starting settlement/river layout.

The community model takes conceptual inspiration from the sibling Kinarium simulation (affinity, trust, morale and bounded encounter history). Kigumi does not depend on that repository or include its cloud/LLM stack.

## Validation and current boundaries

The test suite covers deterministic replay, housing/caps, recruitment, placement and access rules, bridge routing, path speed preference, actual harvesting/delivery, renewable farming, worker limits, construction, research dependencies, dismantling, nonlethal scarcity, bounded relationships, save validation/resumption, path removal and a 200-villager simulation soak. Manual play-testing checks the rendered desktop and browser interfaces. CI builds on macOS, Windows and Linux.

This is an initial playable foundation. Art is procedural and intentionally stylized. There is no audio, combat, multiplayer transport, scenario runner, family simulation, terrain editing or production-chain inventory beyond the four shared resources. Performance tuning for very large settlements and installer signing/distribution remain future work.
