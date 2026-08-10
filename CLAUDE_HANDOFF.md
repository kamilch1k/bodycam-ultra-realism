# Claude-of-Duty local handoff

This is the self-contained local working copy of the game to continue in Claude.

## Project location

```text
C:\Users\rewwe\Documents\Codex\2026-08-01\do-yo\work\claude-of-duty-optimized
```

Open that folder as the project root. It contains the source, Git metadata, the
installed dependencies (`node_modules`), and the latest production build in
`dist/`.

The older prototype is intentionally preserved separately at:

```text
C:\Users\rewwe\Documents\Codex\2026-08-01\do-yo\work\deadshift-last-stand
```

## What this project is

This is the public Claude-of-Duty tactical FPS demo, pulled from:

```text
https://github.com/mshumer/Claude-of-Duty.git
```

It is a Three.js/Vite browser game with a realistic market-street map, M4A1
viewmodel, pointer-lock FPS controls, ADS, shooting, AI soldiers, particles,
audio, post-processing, and a HUD. It is a foundation to improve toward the
Yandex Games/CrazyGames target; it is not yet the zombie/base-building game.

The checkout started from commit `d9b237b75c9304ab8d9ef4cfa0c3568c7c11a853`
(`d9b237b Add updates link to README`). Local changes are intentionally
uncommitted so the next developer can inspect the diff.

## Current local changes

- `src/core/config.js`: the `low` preset is now a web-first profile (0.80 render
  scale, 1024px shadows, 2 cascades, no GTAO/SSR/volumetrics/motion blur, and
  smaller FX budgets).
- `src/core/config.js` and `src/main.js`: the default launch quality is `low`.
- `?q=medium`, `?q=high`, and `?q=ultra` remain available for comparison.
- `package-lock.json` was normalized by `npm install`; the project builds
  successfully with the current lockfile.

## Session 2 changes (Claude)

**Boot time, ~30 s -> ~5 s.** The per-surface texture bakes were never
pixel-bound (a re-bake with the program cached is 0.8 ms); the whole cost was
ANGLE translating each noise shader to HLSL, serially, because `render()`
blocks on link. `TextureForge.warm()` now links all 19 library programs at once
and polls `KHR_parallel_shader_compile`, called from `MaterialSystem.init`.
World init 15.8 s -> 0.8 s. The AI character textures are a CPU bake and are
O(size^2), so `charTextureSize` was added to the quality presets: 256 on `low`
(7.6 s -> 2.1 s), 512 everywhere else.

**The build opens from disk.** `dist/index.html` used to be a black screen when
double-clicked — the entry was `<script type="module" src="/assets/...">`, which
from `file://` resolves to `file:///C:/assets/...` and Chrome refuses to load
module scripts cross-origin. The `ow-inline-entry` plugin in `vite.config.js`
inlines the entry chunk, and `base: './'` makes every other URL relative, so the
one file runs off the disk and from any portal subpath.

**Support-hand wrist.** The wrist sat at 64.4 deg between the forearm axis and
the hand's metacarpal axis — at the anatomical limit, and on screen the sleeve
and glove met at a corner that read as a broken joint. The hand is welded to the
handguard by the build-time contact solve, so the only free variable is the
elbow: `armL` now takes an explicit `pole` (measured by sweeping the
down/outboard hemisphere), which puts the elbow 59 mm further outboard for
47.0 deg, with reach unchanged at 94.6%.

## Session 3 changes (Claude)

**The stutter was never frame cost.** Measured in real Chrome on an RTX 4080 at
1080p: `low` renders a frame in 4.5 ms (222 fps). What players feel is shader
compile stalls — with the pre-warm off, a 20 s camera sweep hits a **1005 ms**
frame and six frames over 33 ms. The pre-warm had been disabled for `low` to
save boot time. Re-enabled at every quality in `main.js`; the same sweep now
peaks at **69 ms**, with nothing over 100 ms.

The trade is boot: the pre-warm is a flat ~20 s for 134 programs, and Chrome's
on-disk program cache does not measurably help (28 s on a return visit vs 40 s
cold). It is already parallel inside each batch — `world` compiles 35 programs in
7.3 s, `render` 51 in 6.3 s — so ~150 ms/program is what ANGLE costs for shaders
this size. Getting first load down needs FEWER or SIMPLER programs, not more
parallelism. `?prewarm=0` restores the instant boot with the stalls.

**Shadows cut.** At 1080p the shadow pass was 326 of the frame's 644 draw calls
and 3.0M of its 5.1M triangles, for 1.3 ms of a 4.5 ms frame. `low` is now one
cascade at 45 m instead of two at 70 m. Dropping shadows entirely was measured
too (3.2 ms) but everything then floats, so one short cascade keeps contact.

**Support hand, part two.** The wrist angle turned out NOT to be the problem: a
sweep of 2942 shoulder/elbow placements could not beat 47.7 deg, and twisting the
hand about the palm normal bottoms out at 46.0 deg — 47 deg is structural, given
the weapon offset and a shoulder behind the eye, and it is inside human range
anyway. The actual defect was that the grip was invisible: at `handZ -0.235` the
hand sat under the receiver with all four fingers and the thumb occluded, so the
screen showed a blunt sleeve meeting a dark blob. Fixed by moving the weapon 45 mm
closer (`hipPos.z -0.30 -> -0.255`) and the hand 50 mm forward along the handguard
(`handZ -0.235 -> -0.285`) TOGETHER — they cancel in reach terms (94.8%, wrist
47.2 deg, both unchanged) but the fingers now wrap the tube in open view. The two
values are coupled; changing either alone clamps the IK into a straight arm.

Still open: the shooting hand measures 123.6 deg at the wrist, which is not
physical — it is mostly hidden behind the receiver, so it has not been chased.

## Session 4 changes (Claude)

**Pre-warm reverted to OFF, and why.** Turning it on in session 3 was a
regression: boot went to 48 s with the MAIN THREAD BLOCKED (measured — a 100 ms
interval ticked 73 times in 37 s), so the page renders nothing and the pause menu
cannot respond to a click. That is not a loading screen, it is a hung tab. One
1-second hitch beats it. `?prewarm=1` still exists. Measured with the simplified
shaders below, the pre-warm is STILL not worth it: +14 s of boot and it does not
even remove the worst frame (438 ms with it, 823 ms without).

**Parallax and detiling off at `low`** (`MaterialSystem._simple`). `OW_PARALLAX`
is a 22-iteration texture march and it is part of the define set that keys the
program cache, so it costs at compile time AND at frame time. Every
"X3595: gradient instruction used in a loop" warning ANGLE prints is that march,
and a texture gradient inside a varying-iteration loop is the worst case for the
HLSL compiler — which is why programs cost ~150 ms each. Result: **206 -> 90
programs**, boot 37 s -> 25 s. Surfaces keep albedo/normal/ORM/detail/macro; what
is lost is parallax depth at grazing angles.

Where it stands, real Chrome, 1080p, RTX 4080: boot 25 s (still main-thread
blocked, still the worst number here), median frame 6.0 ms / 166 fps, and one
823 ms stall per 1200-frame sweep. The remaining boot cost is shader compilation
and the only real lever left is fewer/simpler programs — or a pre-warm that runs
incrementally AFTER the game is interactive, which is the right fix and is not a
config change.

**Support hand, part three — the actual fix.** The wrist angle is controlled by
the grip's CLOCK ANGLE around the handguard, and nothing else. Rolling pos,
finger and back together about the bore axis and re-solving at each step:
roll 0 = 46.7 deg (where it was), +30 = 24.8 deg, +40 = 22.8 deg, +70 = 38.6 deg,
with reach flat at ~94% throughout. Applied +30 (phi 250 -> 280): the hand comes
off the SIDE of the tube, where it was cocked to near the anatomical limit, and
sits UNDER it in an ordinary support grip. Live measurement after the change:
wrist 26.5 deg, reach 94.1%. Combined with the session-2/3 work the forearm now
runs almost straight into the hand instead of meeting it at a corner.

## Run it

From PowerShell:

```powershell
cd "C:\Users\rewwe\Documents\Codex\2026-08-01\do-yo\work\claude-of-duty-optimized"
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Then open `http://127.0.0.1:5173/`.

For a production build/preview:

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Useful renderer comparisons:

```text
http://127.0.0.1:5173/?q=low
http://127.0.0.1:5173/?q=medium
http://127.0.0.1:5173/?q=high
http://127.0.0.1:5173/?q=ultra
```

Low quality skips the expensive full shader pre-warm so the portal build reaches
playable state sooner. Use `?prewarm=1` when profiling shader stalls or when
testing the hitch-free desktop path; `?prewarm=0` explicitly disables it for
any other quality preset.

## Controls

Click the canvas to lock the cursor. `WASD` moves, mouse aims, left mouse fires,
right mouse aims down sights, `Shift` sprints, `R` reloads, `F` uses, and `Esc`
pauses/unlocks the cursor.

## Where to work next

- `src/world/index.js`, `src/world/layout.js`, `src/world/dressing.js`: map
  layout, buildings, props, and collision.
- `src/render/index.js`, `src/render/csm.js`, `src/core/config.js`: lighting,
  shadows, post-processing, and quality presets.
- `src/weapons/`: weapon model, recoil, ADS, fire/reload feel, and weapons.
- `src/ai/`: soldier geometry, animation, navigation, and combat behavior.
- `src/ui/`: HUD, pause menu, settings, and quality selector.
- `tools/`: browser capture, profiling, and deterministic test helpers.

## Suggested first Claude task

Use the prompt below verbatim, then have Claude inspect and modify this folder
in place. Keep the old `deadshift-last-stand` folder untouched until the new
prototype is clearly better.

```text
You are taking over a local browser FPS project. Work directly in:
C:\Users\rewwe\Documents\Codex\2026-08-01\do-yo\work\claude-of-duty-optimized

Read CLAUDE_HANDOFF.md, README.md, ARCHITECTURE.md, and the current git diff
before changing anything. This is the Claude-of-Duty Three.js/Vite demo pulled
from https://github.com/mshumer/Claude-of-Duty.git. Do not replace it with a
new toy prototype and do not touch the separate deadshift-last-stand folder.

First run `npm install`, `npm run build`, and `npm run dev -- --host 127.0.0.1
--port 5173`, then test http://127.0.0.1:5173/ in a browser. The current
default is deliberately the web-safe `low` quality preset: 0.80 render scale,
1024px shadows, 2 cascades, no GTAO/SSR/volumetrics/motion blur. Keep
`?q=ultra` working for comparison.

Continue the performance pass before adding content. Measure startup and frame
cost, especially the very large procedural world/material build, and reduce
avoidable boot work, draw calls, shadow cost, and shader stalls without making
the scene look flat. Keep the first playable scene stable and verify movement,
pointer lock, ADS, firing, reload, pause, and quality switching after changes.

Then improve the foundation toward a publishable Yandex Games/CrazyGames FPS:
better map flow and cover, reliable hits and enemy behavior, stronger weapon
recoil/feedback, and a clear path to the later zombie/base-defense mode. Make
small, testable changes. Preserve existing architecture and document every
meaningful change. At the end, report exactly which files changed, the build
and browser test results, the URL to open, and the next highest-value task.
```
