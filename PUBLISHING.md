# Publishing to Yandex Games and CrazyGames

Two commands produce two submission archives:

```bash
npm run build:yandex
npm run build:crazygames
```

Each writes `dist-portal/<portal>/` and `dist-portal/<portal>.zip`. The archive
is **0.48 MB** — one self-contained `index.html` plus the third-party notices.
Every asset in this game is generated at runtime, so there is no art payload at
all; both portals' size limits (Yandex 100 MB, CrazyGames 500 MB) are two orders
of magnitude away.

Upload the ZIP. Both portals want `index.html` at the archive root, which is
what the packager produces.

---

## BLOCKING before either submission

**The game is called BODYCAM.** That is an active Blizzard Entertainment
trademark in the video-game class, it is displayed at full size on the main menu
and it is in `<title>`. Neither portal will pass certification with it, and
shipping it commercially is an infringement rather than a naming quibble. This
is a decision, not a task — pick a name and it changes in three places:

- `index.html` — `<title>`
- `src/ui/mainmenu.js` — the menu wordmark
- `src/ui/menu.js` — the pause-screen subtitle

Everything else refers to the project as `claude-of-duty` internally, which is
fine; it is not player-visible.

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

## What is deliberately NOT wired: ads

Both portals pay on impressions and both have interstitial and rewarded-video
APIs. Where an ad breaks into a session is a design decision with real
consequences for retention and for certification — Yandex rejects builds that
show an interstitial before the player has played at all. The hooks are in place
(`gameplayStart`/`gameplayStop` are exactly what an ad policy keys off), and the
policy itself needs a decision rather than a guess.

The usual shape, when you want it:

- **Interstitial** between matches, never mid-match, never on first load, and
  with at least 60 s between showings (Yandex enforces this).
- **Rewarded video** for something optional and repeatable.
- Both portals require gameplay to be **paused and muted** for the ad's
  duration; `portal.gameplayStop()` already does the analytics half of that, but
  the audio and the time scale have to be handled at the call site.

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

- [ ] Rename the game (see BLOCKING above)
- [ ] Decide the ad policy, or ship without ads
- [ ] `npm run build:yandex && npm run build:crazygames`
- [ ] Test each archive by unzipping and opening `index.html` directly — it is
      built to run from `file://`, so this catches a broken bundle in seconds
- [ ] Store art: icon and screenshots (both portals require them; neither is
      generated here)
- [ ] Privacy policy URL if you enable ads or any analytics
