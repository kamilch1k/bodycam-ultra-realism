# Hotline Strike — product direction

Forked from `claude-of-duty-optimized` at `2943fb3`, which is where the two
games stop being one game. That repo is wired in as the `shared` remote and is
the common ancestor for both; see "Sharing engine fixes" below.

## What this is

A **fast arcade FPS for mobile web portals** — Yandex Games and CrazyGames.
Short rounds, immediate feedback, forgiving handling. It is the accessible half
of the split. `bodycam-ultra-realism` is the other half and the two are allowed
to diverge as far as they need to; do not add a mechanic here because the other
game has it.

The design target is a player on a phone, on a portal, who gave the tile one tap
and will leave in ten seconds if nothing happens. Everything below follows from
that.

## What has to change from the fork point

**Touch controls — the single biggest piece of work.** The game is pointer-lock
+ WASD today. It needs a twin-stick layout, a fire button, an ADS toggle, and a
UI pass at phone aspect ratios. Both portals weight mobile heavily. This is days
of work, not hours, and nothing else here matters as much.

**Default to a fast map.** The Shoot House and Whitebox load in about a second;
the Street map takes ~25 s, which on a portal is a bounce, not a load. Ship with
Shoot House as the default. Street is optional content at best.

**Soften the handling.** The recoil, spread and movement weight were tuned
against a mouse and a keyboard — see the recoil work in the shared history. On a
thumbstick, that tuning is unplayable. Expect to raise aim assist, cut recoil
substantially, and undo most of the Tarkov-style movement weight (`groundAccel`
went 92 -> 38 for the PC feel; this game probably wants it back near 92).

**Portal SDKs.** Both portals need their JS SDK for ads and lifecycle: a
"loading finished" signal, gameplay start/stop calls around ad breaks, and audio
muted during ads. The menu-first boot already gives a clean place to signal
ready. Verify the current requirements against each portal's own checklist —
they change.

**A few short levels.** Small, readable, fast to load, built from the same
one-material greybox approach as `src/world/shoothouse.js`. Do not port the
Street map's cost model into this game.

## What NOT to do here

- No hardcore mechanics. No stamina, no weapon jams, no realistic wound states.
  Those belong in the other repo and will make this one worse.
- No more render optimisation for its own sake. The frame is 4.5 ms at 1080p and
  has never been GPU-bound. Load time and input latency are the metrics that
  matter on a portal; frame time is already fine.
- No external assets. Everything is generated at runtime, the whole game ships
  as one self-contained HTML file (~508 kB gzip), and that is exactly why portal
  submission is easy. Do not break it for a texture.

## Sharing engine fixes

Both games share an engine and will keep finding the same bugs in it. Cherry-pick
rather than re-fix:

    git fetch shared
    git log --oneline shared/main ^HEAD     # what the other side has fixed
    git cherry-pick <sha>

Engine-level work (viewmodel, hands, ballistics, physics, materials, AI
internals) is worth carrying both ways. Tuning and content are not — they are
the whole point of the split.
