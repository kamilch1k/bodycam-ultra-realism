# Publishing to Yandex Games and CrazyGames

Two commands produce two submission archives:

```bash
npm run build:yandex
npm run build:crazygames
```

Each writes `dist-portal/<portal>/` and `dist-portal/<portal>.zip`. The archive
is **6.5 MB**: `index.html`, the third-party notices, `audio/` and `models/`.
Both portals' size limits (Yandex 100 MB, CrazyGames 500 MB) are still a long
way off.

It used to be 0.48 MB and one self-contained file, because every asset was
generated at runtime. Three downloaded files now break that — the music
(CC BY 4.0) and the zombie mesh (CC BY 3.0). Two consequences worth knowing:

  - **The `file://` check in the checklist no longer covers assets.** `fetch()`
    is blocked on `file://`, so the model 404s when you double-click index.html
    even though the page itself loads. Serve over http to test for real:
    `npx vite preview`, or any static server.
  - **Attribution is now a licence condition, not a courtesy.** See
    THIRD-PARTY-NOTICES.txt; the credit also belongs in each store listing.

Upload the ZIP. Both portals want `index.html` at the archive root, which is
what the packager produces.

---

## Rename — already done

The game is titled **Bodycam — Ultra Realism** in `<title>`, the main-menu wordmark, and
the pause-screen subtitle. (This section used to warn that the name was an
active Blizzard trademark — that was leftover text from the OVERWATCH original
this project forked from, not a real issue with "Hotline Strike".) Internally
the project still refers to itself as `claude-of-duty`, which is fine; it is
not player-visible.

---

## What is already wired

`src/core/portal.js` attaches the right SDK per build and normalises the four
calls both portals require:

| | Yandex | CrazyGames |
|---|---|---|
| SDK | `yandex.ru/games/sdk/v2` | `sdk.crazygames.com/crazygames-sdk-v3.js` |
| game is playable | `features.LoadingAPI.ready()` | `game.loadingStop()` |
| play started | `features.GameplayAPI.start()` | `game.gameplayStart()` |
| play stopped | `features.GameplayAPI.stop()` | `game.gameplayStop()` |

The SDK load is raced against a 6 s timeout and every method is a no-op when no
portal is attached, so a slow or unreachable portal can never be the reason the
game fails to start — and the dev server, `file://` and any other host keep
working with no branch anywhere else in the codebase.

`ready()` fires once the main menu is up, which is the honest definition of
"playable" here: the menu paints at ~490 ms while map generation takes 12-25 s
behind its own loading screen. The gameplay bracket follows the pause menu and
tab visibility, because both portals use it for session analytics and Yandex
certification checks it.

## Ad policy — decided: one interstitial per session boundary

`modes/index.js` emits `match:end` when a Strike match ends (win or lose) and
when a Holdout run ends (death) — never mid-match, never on the first load.
`main.js` listens for it and calls `portal.showInterstitial()`, which itself
enforces the 60 s minimum gap, mutes and pauses for the ad's duration, and
restores both on every exit path including errors. No rewarded video yet —
optional/repeatable rewards would be the natural place for one, not added
because there is no reward to gate on it.

## Portal-specific notes

**Yandex.** Russian and English store listings are mandatory. Draft builds are
private until moderation passes; moderation is manual and takes a few days. The
SDK must be loaded from `yandex.ru`, not bundled — a self-hosted copy is an
automatic rejection.

**CrazyGames.** Wants a playable build behind a URL for QA before the store
listing goes live, and tests on mid-range hardware. The default quality preset
is already the web profile (`low`: one shadow cascade at 45 m, no SSR/GTAO/
volumetrics/motion blur, 0.80 render scale) and the Advanced graphics panel lets
a player turn shadows off entirely, so there is headroom below the default.

## Checklist

- [x] Rename the game
- [x] Decide the ad policy
- [ ] `npm run build:yandex && npm run build:crazygames`
- [ ] Test each archive by unzipping and opening `index.html` directly — it is
      built to run from `file://`, so this catches a broken bundle in seconds
- [ ] Store art: icon and screenshots (both portals require them; neither is
      generated here)
- [ ] Privacy policy URL if you enable ads or any analytics
