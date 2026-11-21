# SYNQ desktop reconstruction — melo reference map

Reference: melo desktop (Electron renderer, `D:\melo\src\renderer`), verified from
source. SYNQ's architecture (routing, store, engines, auth) is preserved; this map
ports melo's *visual system and interaction language* onto it.

## Implementation map

| Area | melo (verified) | SYNQ current | Work |
|---|---|---|---|
| Shell geometry | Floating-panel composition: 80px icon rail (radius 28) · main content card (radius 28, pad 28px 36px, bottom 120px for the player) · right now-playing panel (340px, radius 28) · playbar floats (inset 16px, h 88px, radius 28, 3-col grid, bg visualizer) — styles.css:492/2597/1954 | 72px glass rail · flush main (max-w-6xl) · island playbar (68-76px, rounded-[2rem], 760px cap) | Desktop main content becomes an elevated rounded card; playbar adopts melo's full-width floating-card geometry (h-88, radius 28, 3-col) with the bg visualizer; mobile island unchanged |
| Motion | M3 emphasized 350ms cubic-bezier(0.2,0,0,1); hover 70ms in / 100ms out; staggered row entrances (30ms steps ×8); press scale 0.98 | --ease-out/in-out/drawer, 200ms default | Add M3 emphasized curve + stagger util; apply press-scale + fast hover to rows/cards |
| Track rows | pad 10px 18px, radius 20, hover fills surface-container, staggered fadeUp, playing state | min-h-14 rows, rounded-xl, px-3, hover white/5 | Adopt density, radius 20, stagger, hover/press |
| Cards/shelves | mix-card: container bg, radius 16, pad 20, hover -4px; sp-row: 176px columns, gap 16, edge fade masks, cover radius 14, 15px/600 titles | MediaCard rounded-2xl; Shelf infinite-slider | Align card geometry + shelf masking |
| Artist page | Hero image w/ back button · name + verified + fans line · About card w/ bio · horizontal tabs (Tracks / Albums) · Popular header w/ Play + Show all · albums grid — index.html:420-470 | Header w/ small artwork + name + actions · Popular · Discography groups · All songs — Artist.tsx | Restructure into hero + horizontal tabs, keep SYNQ's discography engine |
| Album page | Same hero language | Simple header | Hero treatment |
| Queue | Press-hold pointer drag reorder w/ edge autoscroll — app.js initListReordering | QueuePanel slide-over w/ reorder | Adopt drag visuals/autoscroll; keep mechanics |
| Lyrics | Right panel: Word/Line mode toggle, gradient wordstyle, TV karaoke, Edit/Sync actions — index.html:2002-2151 | Fullscreen player lyrics + word karaoke | Adopt gradient wordstyle + mode toggle visuals |
| Playbar | bg visualizer canvas · morphing play/pause · marquee title · inline fav/edit/download/share | transport/seek/volume · marquee exists · inline actions exist | Add bg visualizer; adopt melo grid |
| Theme | M3 tokens + zinc reskin (#09090b bg, hairline borders #52525b/#26262b, 32px pointer-density rows) + ui-alpha transparency | Warm-ink oklch + --tint + card alpha + scenes | Adopt hairline discipline + container scale; keep SYNQ palette |

## Intentionally not copied

- melo's right-panel app model (SYNQ keeps fullscreen player + slide-over queue)
- Native OS context menus via IPC (SYNQ's Radix menus are web-correct)
- Monaco CSS editor, plugin system, CLI (desktop-shell features, not UI language)
- Storage.json single-file persistence (SYNQ keeps zustand + Convex)

## Phases

- 3A tokens/motion → 3B shell geometry → 3C rows/cards/shelves → 3D artist/album
  heroes → 3E playbar → 3F queue/lyrics polish. Each phase: tsc + tests + build.

## Phase 2 (shipped)

- Artist page horizontal tabs — melo's `artist-horiz-tabs` language (rounded-top
  chips, tint bottom indicator): Popular / Discography / All songs as panes that
  stay MOUNTED while hidden, so tab switches never re-fire provider requests or
  reset hydration progress. Verified live (tab switch + pane visibility).
- Queue drag autoscroll — melo's `initListReordering` numbers verbatim (40px edge
  zones, 8px per 16ms ≈ 480px/s) as `useQueueDragAutoscroll` in QueuePanel, plus
  the lift visual (`whileDrag` scale 1.02, z-30).
- Rail playlists drawer NOT built: SYNQ's collapsed rail already renders playlist
  cover chips + an expand control, which covers the same need without a second
  surface. Lyric wordstyle already matches melo's gradient fill.

## Phase 3 (shipped)

- Playing-row signature: the rank number becomes live EQ bars on the row that is
  actually sounding (RemoteTrackRow → Equalizer).
- Playbar title marquee: overflowing titles scroll end-to-end under a 24px
  right-edge fade (MarqueeText in PlayerBar + `title-marquee` keyframes);
  measured shift via `--marquee-shift`, rests at both ends, inert under
  reduced motion, ResizeObserver feature-detected for happy-dom.
- Morphing play/pause glyph: melo's two-path `d`-transition SVG ported verbatim
  (`play-pause-morph` in index.css) into TransportControls — applies to the
  PlayerBar AND the fullscreen player (both render TransportControls).
