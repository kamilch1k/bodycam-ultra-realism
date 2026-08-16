# Stutter / performance handoff

Branch `survivors-mode`, 4 commits ahead of `main`. Everything below was measured,
not guessed. Where something is unverified it says so.

---

## The one thing that matters

**The stutters have NOT been confirmed fixed.** Two real unbounded leaks were found
and fixed, and a 20-wave soak now shows nothing growing — but nobody has played the
game since. No frame-time profile of actual play exists. See "What was never done".

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

- **0 of the 115 programs is unused.** Every one is genuinely drawn with, so there is
  no dead permutation to delete (`tools/program-census.mjs`).
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

**The only lever left** is deferring the pose-drawing compile passes past the point of
interactivity — compile across frames at a budget once the player can already see and
click something. That is architectural and was not attempted.

---

## What was never done

- **No frame-time profile of real play exists.** `tools/playprofile.mjs` was written to
  do exactly this — holds WASD, swings the view, fires in bursts, spawns waves, and
  records per-system CPU cost per frame plus allocation deltas. **It never completed a
  run**: every attempt exceeded 10 minutes headless and was killed. The harness is the
  useful part and is committed; it needs a much lower frame count or a real GPU.
- **Nobody has played the build since the fixes.** All verification is headless.
- **The teleport bug was fixed earlier and has not regressed in tests**, but was also
  never re-confirmed by a human playing.
- **Ghouls upload 4 textures per wave** — pre-existing, unrelated to the survivors work,
  never chased down.

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
| `tools/playprofile.mjs` | per-frame cost of scripted play — **never completed** |
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
