# Bodycam Ultra Realism — product direction

Forked from `claude-of-duty-optimized` at `2943fb3`, which is where the two
games stop being one game. That repo is wired in as the `shared` remote and is
the common ancestor for both; see "Sharing engine fixes" below.

## What this is

A **hardcore PC tactical shooter with a bodycam presentation**. Slow, heavy,
punishing. Desktop only, mouse and keyboard, no portal, no ads. It is the
uncompromising half of the split. `hotline-strike` is the other half; do not
soften anything here because that game needed it soft.

The design target is a player who wants the room to be dangerous — who will
accept dying to one round from a doorway they did not clear.

## What this fork already has going for it

Most of the tuning at the fork point was already pulling this direction and
should be kept, not undone:

- Movement weight lives in acceleration, not top speed. `groundAccel` is 38, so
  full speed takes ~105 ms instead of 50 — you feel the start, and a direction
  change costs you something.
- Recoil is split into a learnable deterministic climb and an unlearnable cone,
  with a real permanent camera component that bleeds in over ~45 ms.
- The AI fights indoors: cover ranges scale with engagement distance, squads
  approach on fanned bearings, and suppressors genuinely change who hears you
  (26 m against 105 m bare).
- The Shoot House map is a six-room CQB kill house, which is the right shape for
  this game's fights.

## Where to take it

**Bodycam presentation.** This is the identity and it is mostly a render and
camera problem: a heavy vignette, chromatic aberration and lens distortion, a
rolling-shutter wobble, sensor grain that climbs in the dark, auto-exposure that
visibly hunts when you swing from a dark room into daylight, and a low, chesty
camera mount that bobs with the body rather than floating at eye level. The
engine already has an AgX-graded composite pass to hang this on.

**Hardcore mechanics.** Stamina and breath affecting sway. Wound states that
persist. No health regeneration. Magazine-level ammo tracking (you keep the
partial mag you dropped, and you do not know its count). Weapon jams. Realistic
one-to-two-round lethality in both directions.

**Lean into the AI work.** The remaining gap is genuine squad room-clearing —
one man holding a doorway while another crosses. That is a behaviour tree, and
it matters far more in this game than in the arcade one.

**Audio as information.** The formant bark system and the material-aware
footstep foley are already there. In a game where you die to what you did not
hear, they are load-bearing, and they deserve occlusion and reverb by room.

## What NOT to do here

- No touch controls, no portal SDKs, no ad breaks. Those are the other repo's
  problem and they constrain design in ways this game should not accept.
- Do not chase load time at the cost of fidelity. There is no portal bounce rate
  to worry about; a 25 s load behind a proper loading screen is survivable here
  in a way it is not in `hotline-strike`.
- No external assets, for now. Everything is generated at runtime and the whole
  build is one self-contained file. That constraint has produced a coherent look
  and it is worth keeping until something genuinely needs breaking it.

## Sharing engine fixes

Both games share an engine and will keep finding the same bugs in it. Cherry-pick
rather than re-fix:

    git fetch shared
    git log --oneline shared/main ^HEAD     # what the other side has fixed
    git cherry-pick <sha>

That is the steady state. It did not happen: 47 commits and +12k lines piled up
on the arcade fork — the real-hardware stutter fixes, the prewarm rework, the
baked shot bank, the survivors loop, three maps, saves, i18n and two dozen
profiling tools — while this fork sat at the split, so the whole thing was
merged across in one go instead (`arcade` remote, `arcade/survivors-mode`).
Conflicts were resolved toward this fork's identity. The arcade-shaped parts
came with it and are inert here rather than deleted: touch controls and aim
assist are gated on a coarse pointer, and the portal SDK and its ad breaks only
exist in a `VITE_PORTAL` build, which this game does not make. Deleting them
would only make the next merge harder.

Engine-level work (viewmodel, hands, ballistics, physics, materials, AI
internals) is worth carrying both ways. Tuning and content are not — they are
the whole point of the split.
