# Stutter / performance handoff

Branch `survivors-mode`, 4 commits ahead of `main`. Everything below was measured,
not guessed. Where something is unverified it says so.

---

## The one thing that matters

**The previously inferred stutters are now measured and fixed on a real GPU.** A
210-second Chrome trace on an RTX 4080 Laptop GPU covered waves 1–8, burst fire,
WASD, camera flicks, 38 pickup spawns, 29 accepted pickups, 12 level-ups, death and
respawn. It recorded 34,258 play frames at p50 6.1 ms, p99 6.2 ms, max 36.5 ms.
The sole frame over 24 ms was 33.6 ms of browser/OS inactivity followed by 2.8 ms
of renderer-main work; it had no program/geometry/texture delta. No game system or
draw call produced a >24 ms frame.

Baseline on the same hardware had seven >24 ms frames and a 1,109 ms maximum:

| trigger | baseline | fixed |
|---|---:|---:|
| dropped rifle magazine (rubber/cavity/metal ANGLE links) | 624–1,109 ms | no cold link |
| first visible pickup | 478 ms | 2.5 ms focused probe; 6.2 ms max across 38 spawns |
| first visible enemy materials/prepass | 266–327 ms cold frame | 18.1 ms cold frame |
| wave spawn | 24–55 ms | 12.1 ms max |

The Chrome Performance trace and frame/event data are in the Codex task's
`outputs/gpu-play-trace-after.json` and `outputs/gpu-play-data-after.json`.

---

## Fixed, with evidence

### 1. Per-drop GPU allocation (commit `9d653c7`)

Every pickup built a fresh `BoxGeometry` + `MeshStandardMaterial`; every flat enemy
drew its own canvas and uploaded its own `CanvasTexture`. `parent.remove()` unhooks a
mesh but disposes nothing, and drops happen on kills, so both leaked continuously.

| | before | after |
|---|---|---|
| pickups | 10 geometries + materials per 10 drops, no ceiling | 1 once, then 0 |
| flat enemies | 4 textures per wave, forever | 0 |

Fixed by **sharing**, not by disposing: one geometry + material per pickup kind, 8
faces shared across all flat enemies. A mesh holding a borrowed geometry owns nothing,
so there is nothing to free.

The per-drop `MeshStandardMaterial` is the most likely cause of the *harsh* stutter
specifically: a new material means a new program for the renderer to set up, and the
material patcher wraps it, so a pickup could plausibly cost a shader compile mid-fight.

Gotcha worth keeping: `prewarmFaces()` needs `renderer.initTexture()`. Creating a
`CanvasTexture` defers the GPU upload to first draw, so prewarming without it moves
the canvas work to boot and leaves the stall exactly where it was.

### 2. Pickups never expired (commit `e3f23dc`)

110 uncollected pickups on the map after 20 waves; scene nodes climbing 22/wave with
no ceiling. Each is bobbed, spun and distance-checked **every frame** — per-frame cost
that only goes up. Now 45 s TTL + hard cap of 20, oldest evicted first.

Soak result after the fix (`node tools/soak.mjs 20`):

```
  wave   textures  geometries  programs   nodes
     4        120         180       118     416
    20        120         180       118     416
```

Flat. `tools/soak.mjs` clears the dead between waves the way `HordeMode.begin` does —
without that it blames the game for corpses the real game never keeps.

---

## Boot / load time — measured, and it changes the plan

**Pre-baking meshes to files will not help.** All procedural generation together is
~4 s; the rest of boot is shader compilation.

```
characters   1.85 s
fx atlases   0.65 s
level        0.22 s
variants     0.20 s
nav          0.06 s
-------------------
~4 s of generation, vs 115 shader programs for the rest
```

- The old “0 of 115 programs unused” conclusion was invalid: Three's
  `WebGLProgram.usedTimes` is a live material reference count, not a draw counter.
  Boot was compiling 37 duplicate light permutations (3 directional / 4 point,
  then 3 / 20) while gameplay uses 2 / 20. Mirroring the real light collection,
  sun takeover and ballast order reduced the hardware prewarm from 117 to 80
  programs.
- `compileAsync` (KHR_parallel_shader_compile) and per-stage `requestAnimationFrame`
  yielding are **already implemented**.
- Character material caching is **correct**: 21/21 textures reused per wave, 0 rebuilt.

Prior measurement recorded in `src/main.js`:

```
prewarm on    boot 48 s, worst in-play frame   69 ms
prewarm off   boot  5 s, worst in-play frame 1005 ms
```

(48 s is headless software rasterisation, not real hardware — treat the ratio as real
and the absolute numbers as inflated.)

That architectural change is now implemented. The DOM menu paints and becomes
clickable before engine construction; prewarm admits one coarse driver job per rAF
and can be aborted/rebuilt when the map changes. Measured on hardware:

```
menu interactive       0.60-0.63 s
Play click handling    32 ms
prewarm                ~8.3 s warm sample, 80 programs (was ~12.6 s / 117)
full playable          16.9-18.2 s cold samples
```

The stopped background engine's input is suppressed until Play, so menu clicks
cannot accidentally request pointer lock. A rejected Miami minimap depth bake is
also finalized to its existing grid fallback behind the menu; it no longer repeats
the same 512 px readback at frames 20/40/... during play.

---

## What was never done

- The automated real-rAF/CDP run exercises the requested play path, but it is still
  scripted rather than a subjective human feel test.
- The teleport bug remains covered by the existing checks; the hardware profile did
  not show a camera-flick correlation (flick p99 6.2 ms, max 12.1 ms).
- The ghoul “4 textures per wave” was chased: these are per-visible-agent Skeleton
  bone `DataTexture`s, not rebuilt shared character textures. `Agent.dispose()` had
  never disposed its Skeleton, so old bone textures remained renderer-resident.
  Skeletons are now disposed. New agents still allocate their tiny bone texture when
  first visible, but the real trace measured those uploads at 0.1–0.4 ms and the
  20-wave renderer totals are flat.

---

## Measurement discipline that matters here

Headless Chromium has no GPU. It software-rasterises every frame at ~2 fps.

- **Trustworthy**: object counts (textures/geometries/programs/nodes), CPU time in
  JavaScript, nav/path results, simulation logic, allocation volume.
- **Fiction**: anything that touches draw cost. `render` system timings, total frame ms.

Two techniques that made the difference:

1. **Pump frames by hand.** `engine.step(now)` in a loop with `render.render` stubbed
   gives ~30,000 simulation frames in seconds instead of ~80 via rAF. This is what
   finally reproduced the original teleport bug.
2. **Compare object identity, not counts.** "+21 textures" is not a leak — despawning
   removes bodies from the scene, so cached textures legitimately look new when the
   next wave re-adds them. Compare uuids *across* rounds.

Mistakes made and corrected, so they are not repeated: measuring a chase while the
game was frozen behind a modal card; comparing against a stale agent roster while the
mode respawned waves underneath; asserting a paint's red channel was bright when the
paint was deliberately authored cool.

---

## Tools

| tool | what it answers |
|---|---|
| `tools/soak.mjs [waves]` | does anything grow over a long run |
| `tools/spawn-cost.mjs` | what a wave / 10 pickups allocate |
| `tools/tex-diff.mjs [variant]` | *which* textures a wave adds, by identity |
| `tools/program-census.mjs` | what the boot shader programs are, how many unused |
| `tools/boot-profile.mjs` | where boot time goes, by subsystem |
| `tools/playprofile.mjs [frames] --headed` | per-system CPU/allocation scripted play on installed Chrome; final 600-frame run completed, CPU max 4.7 ms, 0 mid-play compiles |
| `tools/play-check.mjs` | survivors loop wiring end to end |
| `tools/nopause-check.mjs` | level-ups do not touch time/control/pointer lock |
| `tools/variant-check.mjs` | every enemy variant builds, moves, dies |
| `tools/paint-check.mjs` | a painted surface renders the colour it names (no browser) |

All browser tools need `npx vite --port 5181 --strictPort` running first.

---

## Also in this branch, unrelated to stutters

- Lighting fix: maps rendered grey because `setWeather` was called with wrong key names
  (`coverage` vs `cloudCoverage` — `Object.assign`, so silently ignored), fog replaced
  the sky dome at any density above 0, and surface tint is a *multiply* on a 0.316
  linear albedo so no hex can reach white. Tints are now gains >1.
- Survivors loop: kills → XP → levels, drops (ammo/armour/upgrade), armour as a real
  pool that soaks whole hits.
- Level-ups no longer pause: perk auto-granted, reel under the compass reports it.
- Menu restricted to Miami + Zone.
- `src/ui/perkcard.js` is now dead code.

Known cosmetic issue: runt and brute read as dark shapes against the new white deck.
