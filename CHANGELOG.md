# Changelog

All notable changes to SYNQ, newest first.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and semantic versioning.

---

## [Unreleased] — Browse-first release

The headline change: **SYNQ no longer asks you to create an account before
you've used it.** You land, you browse, and the app asks for a session at the
moment you do something that genuinely needs one.

### Added

#### Crossfade & gapless playback

Songs now blend into one another instead of stopping dead at the end of a
track.

- **Crossfade** — `0 / 2 / 4 / 6 / 8 / 10` seconds, configured in
  **Settings → Audio**.
- **Equal-power fade curve.** A linear crossfade dips audibly in the middle,
  because the sum of two linear ramps is not constant power. The curve is
  `sin`/`cos`, so the perceived level holds steady through the blend.
- **Gapless playback**, on by default — no dead air between tracks.
- **Preloading.** The incoming track is fetched up to 12 seconds before it is
  needed, so a crossfade never starts from a cold buffer.
- **Stream rescue.** Tracks that refuse to play inline are automatically
  re-resolved to a direct audio stream instead of failing silently.

Implemented with a **two-deck** audio architecture: a second `<audio>` element
with its own `MediaElementSource` and its own transition gain feeding the
shared EQ chain. One element cannot overlap itself.

#### Installable app (PWA)

SYNQ installs to a device and keeps working without a network.

- Install from the **landing page**, the in-app strip, or **Settings → App**.
- Offline shell and image caching via a versioned service worker.
- Launches standalone — no browser chrome.
- Home-screen shortcuts to Home, Search, Liked and Discover.
- Custom icons (192/512, plus a maskable variant) and iOS home-screen metadata.
- **Non-disruptive updates.** A new version is downloaded in the background and
  applied only when it is safe — the app will not swap the bundle out from under
  a playing track. `skipWaiting` is never called on install.

#### Deferred authentication

- `/home`, `/search`, `/discover`, `/artist/*` and `/album/*` are open to
  visitors.
- Sign-in is requested **contextually**, when playback or a save is attempted.
- **Intent is preserved.** Click Play, sign in, and that exact song starts — no
  clicking twice. This works across the OAuth round-trip, because the pending
  action is serialisable data in `sessionStorage` rather than an in-memory
  closure that a document navigation would destroy.
- **Non-blocking dismissal.** "Maybe later", Escape and an overlay click all
  return you to the exact page, scroll position and selection you left.
- Sign-in opens as a dialog over the current page. No redirect, no reload.
- Reuses the existing Google / GitHub / email-code providers through a single
  extracted `AuthForm`, so the page and the dialog cannot drift apart.

#### Account control

- **Switch account** and **Sign out** are now reachable from the sidebar and
  the phone menu. Previously three sign-out implementations existed and none
  could be opened.
- Signing out **wipes the local listening session** — queue, history and the
  half-played track — so a shared device does not hand the next person the
  previous listener's state.
- Visitors are labelled **"Browsing as guest"** with a single honest *Sign in*
  action, instead of a profile link and a sign-out button that do nothing.

### Fixed

#### Playback

- **Silent playback.** `createMediaElementSource()` permanently diverts an
  `<audio>` element's output into the Web Audio graph. The graph was built with
  the element captured *before* the chain to `destination` existed, so any
  failure in between (notably a missing `createStereoPanner` on older Safari and
  some WebViews) left an element feeding nothing at all — the player advanced,
  the progress bar moved, and there was no sound. The graph is now built and
  connected before anything is captured, and a failed build can no longer
  orphan an element.
- **Crossfade ran once per session.** Releasing a deck tore down its graph
  nodes permanently, so after the first transition the app silently fell back to
  hard cuts.
- **Manual Next restarted the song.** The next-track press armed a transition
  for the track it was about to play, which then crossfaded into a duplicate of
  itself.

#### Navigation & layout

- **Settings section chips did nothing.** The scroll resolver picked the nearest
  *matching* ancestor rather than the nearest *scrollable* one, so clicks wrote
  to a container that could never move. It also queried a `data-` attribute
  that exists nowhere in the app.
- **"Your Data" rendered above "Playback".** A positional CSS ladder re-ordered
  the settings panel behind the section list's back; inserting one new section
  shifted every `nth-of-type` slot after it.
- **The ⌘K hint was clipped.** A ~110px pill was mounted in the 72px collapsed
  sidebar rail, so the `⌘K` badge was cut off on every render.
- **The install banner overlapped the queue panel**, pinned over the exact
  pixels it slides across.

#### Search

- **Artist pages reported "Nothing found" for artists that exist.** The page
  fired two InnerTube searches concurrently, which this deployment's IP is
  rate-limited into answering with empty results. Searches are now sequential,
  paced and retried using the constants already proven by the playlist-repair
  path, and a throttled request is reported as *throttled* rather than as an
  artist with no songs.
- A genuine empty result and a refused request are now distinct states, and
  only the latter offers a retry.

#### Input & accessibility

- **Space no longer fires over a focused control.** The global shortcut handler
  swallowed Space and issued its own play/pause, which both broke keyboard
  activation of buttons and could trigger a sign-in prompt a visitor never
  asked for.
- The settings scroll rail and the account menu gained regression tests after
  both shipped broken.

### Security

No change. This release is a user-experience change only.

The deferred-authentication gate is a **client-side courtesy, not a security
control**. Every Convex mutation that requires an identity still resolves the
session server-side and throws without one; `getAuthUserId` guards are
untouched, and the recommendation engine still returns no signals for an
anonymous caller rather than fabricating a listening history.

### Known limitations

- The install flow requires a **published build**. It is gated on
  `import.meta.env.PROD` because a service worker in front of a dev server
  caches module URLs that are re-hashed on every dependency re-optimisation —
  which is precisely the stale-bundle failure a service worker exists to
  prevent. The UI names this reason rather than failing silently.
- Some YouTube videos cannot be played through the embed path and depend on
  direct-stream resolution succeeding.
- `/liked`, `/playlists`, `/playlist/:id`, `/stats`, `/recent`, `/social`,
  `/profile`, `/settings` and `/admin` still require an account. They show a
  signed-in person's library and history; there is nothing there for a stranger.
