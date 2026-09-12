// ---------------------------------------------------------------------------
// SoundCore demo catalog
// A fixed catalog of tracks mapped to reliable, streamable demo audio files
// (SoundHelix sample MP3s). Metadata is fictional but fully searchable, and
// every album ships a generated cover so the whole app feels alive.
// ---------------------------------------------------------------------------

export interface Artist {
  id: string;
  name: string;
  bio: string;
}

export interface Album {
  id: string;
  title: string;
  artistId: string;
  year: number;
  description: string;
  /** hex colors used to generate the cover art */
  palette: [string, string, string];
  /** fallback accent (rgb) derived from the palette, used until the real
   *  cover art is sampled for a dynamic tint */
  accent: { r: number; g: number; b: number };
  /** which generative art variant this album uses (0-5) */
  variant: number;
}

export interface Track {
  id: string;
  title: string;
  artistId: string;
  albumId: string;
  audioUrl: string;
  /** duration in seconds (matches the underlying demo audio file) */
  duration: number;
  /** 0-100, drives "top tracks" sorting */
  popularity: number;
  moods: string[];
}

export interface Mix {
  id: string;
  title: string;
  description: string;
  gradient: [string, string];
  trackIds: string[];
}

// --- artists ----------------------------------------------------------------

export const ARTISTS: Artist[] = [
  { id: "vera-lumen", name: "Vera Lumen", bio: "Electro-pop architect from the neon districts." },
  { id: "neon-fields", name: "Neon Fields", bio: "Sunset synth and chrome guitars." },
  { id: "sable-ash", name: "Sable & Ash", bio: "Slow-burning indie rock duo." },
  { id: "glass-harbor", name: "The Glass Harbor", bio: "Ambient tides recorded near the sea." },
  { id: "cassette-coast", name: "Cassette Coast", bio: "Dream pop for humid summers." },
  { id: "nocturne-city", name: "Nocturne City", bio: "Lo-fi beats made after midnight." },
  { id: "aurora-motive", name: "Aurora Motive", bio: "Cinematic electropop with orchestral swells." },
  { id: "velvet-antenna", name: "Velvet Antenna", bio: "Groove-heavy funktronica from the warehouse district." },
  { id: "paper-jupiter", name: "Paper Jupiter", bio: "Folktronica stories mapped by hand." },
  { id: "iron-meridian", name: "Iron Meridian", bio: "Alt-rock with stadium-sized choruses." },
  { id: "lumen-vale", name: "Lumen Vale", bio: "Ethereal vocal electronica from the coast." },
  { id: "sundial-theory", name: "Sundial Theory", bio: "Future soul with a brass backbone." },
];

// --- albums -----------------------------------------------------------------

const ACCENT = {
  violet: { r: 124, g: 58, b: 237 },
  ember: { r: 234, g: 88, b: 12 },
  cobalt: { r: 37, g: 99, b: 235 },
  teal: { r: 13, g: 148, b: 136 },
  rose: { r: 225, g: 29, b: 72 },
  pine: { r: 22, g: 163, b: 74 },
  fuchsia: { r: 162, g: 28, b: 175 },
  amber: { r: 202, g: 138, b: 4 },
  lime: { r: 101, g: 163, b: 13 },
  red: { r: 220, g: 38, b: 38 },
  sky: { r: 14, g: 165, b: 233 },
  indigo: { r: 99, g: 102, b: 241 },
} as const;

export const ALBUMS: Album[] = [
  {
    id: "prism",
    title: "Prism",
    artistId: "vera-lumen",
    year: 2024,
    description: "Chromatic electro-pop that bends light into hooks.",
    palette: ["#2e1065", "#7c3aed", "#d8b4fe"],
    accent: ACCENT.violet,
    variant: 0,
  },
  {
    id: "afterglow",
    title: "Afterglow",
    artistId: "neon-fields",
    year: 2024,
    description: "Sunset synth anthems for the golden hour.",
    palette: ["#431407", "#ea580c", "#fcd34d"],
    accent: ACCENT.ember,
    variant: 1,
  },
  {
    id: "midnight-meridian",
    title: "Midnight Meridian",
    artistId: "sable-ash",
    year: 2023,
    description: "A sleepless indie record that maps the city after dark.",
    palette: ["#082f49", "#2563eb", "#bae6fd"],
    accent: ACCENT.cobalt,
    variant: 2,
  },
  {
    id: "tidal",
    title: "Tidal",
    artistId: "glass-harbor",
    year: 2023,
    description: "Ambient currents and slow-motion shimmer.",
    palette: ["#042f2e", "#0d9488", "#99f6e4"],
    accent: ACCENT.teal,
    variant: 3,
  },
  {
    id: "summer-static",
    title: "Summer Static",
    artistId: "cassette-coast",
    year: 2022,
    description: "Lo-fi dream pop drenched in humidity and reverb.",
    palette: ["#4c0519", "#e11d48", "#fecdd3"],
    accent: ACCENT.rose,
    variant: 4,
  },
  {
    id: "streetlights",
    title: "Streetlights",
    artistId: "nocturne-city",
    year: 2022,
    description: "Hazy beats for 2 a.m. walks home.",
    palette: ["#052e16", "#16a34a", "#d9f99d"],
    accent: ACCENT.pine,
    variant: 5,
  },
  {
    id: "polarize",
    title: "Polarize",
    artistId: "aurora-motive",
    year: 2025,
    description: "Cinematic electropop that splits the night into color.",
    palette: ["#3b0764", "#a21caf", "#f0abfc"],
    accent: ACCENT.fuchsia,
    variant: 0,
  },
  {
    id: "gold-wiring",
    title: "Gold Wiring",
    artistId: "velvet-antenna",
    year: 2024,
    description: "Groove-heavy funktronica wired for the dancefloor.",
    palette: ["#713f12", "#eab308", "#fef08a"],
    accent: ACCENT.amber,
    variant: 4,
  },
  {
    id: "cartography",
    title: "Cartography",
    artistId: "paper-jupiter",
    year: 2024,
    description: "Folktronica roadmaps drawn in pencil and pollen.",
    palette: ["#14532d", "#65a30d", "#d9f99d"],
    accent: ACCENT.lime,
    variant: 5,
  },
  {
    id: "fault-lines",
    title: "Fault Lines",
    artistId: "iron-meridian",
    year: 2025,
    description: "Alt-rock built on shifting ground and big choruses.",
    palette: ["#450a0a", "#dc2626", "#fca5a5"],
    accent: ACCENT.red,
    variant: 2,
  },
  {
    id: "halo-signal",
    title: "Halo Signal",
    artistId: "lumen-vale",
    year: 2023,
    description: "Ethereal vocal electronica broadcast from the coast.",
    palette: ["#0c4a6e", "#0ea5e9", "#bae6fd"],
    accent: ACCENT.sky,
    variant: 1,
  },
  {
    id: "low-light-theory",
    title: "Low Light Theory",
    artistId: "sundial-theory",
    year: 2023,
    description: "Future soul and brass for the hour after sunset.",
    palette: ["#1e1b4b", "#6366f1", "#c7d2fe"],
    accent: ACCENT.indigo,
    variant: 3,
  },
];

// --- tracks -----------------------------------------------------------------

const SONG = (n: number) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`;

/** duration in seconds of each SoundHelix demo file (320 kbps CBR) */
const DUR: Record<number, number> = {
  1: 224, 2: 256, 3: 206, 4: 182, 5: 212, 6: 168, 7: 252, 8: 195,
  9: 234, 10: 316, 11: 331, 12: 308, 13: 282, 14: 310, 15: 263, 16: 290,
};

const T = (
  id: string,
  title: string,
  artistId: string,
  albumId: string,
  song: number,
  popularity: number,
  moods: string[],
): Track => ({
  id,
  title,
  artistId,
  albumId,
  audioUrl: SONG(song),
  duration: DUR[song],
  popularity,
  moods,
});

export const TRACKS: Track[] = [
  // Prism — Vera Lumen
  T("prism-chromatic", "Chromatic", "vera-lumen", "prism", 1, 92, ["synth", "dance"]),
  T("prism-lucid-skyline", "Lucid Skyline", "vera-lumen", "prism", 2, 87, ["synth", "night"]),
  T("prism-fall", "Prism Fall", "vera-lumen", "prism", 3, 78, ["synth", "dream"]),
  T("prism-velvet-static", "Velvet Static", "vera-lumen", "prism", 4, 74, ["synth", "dance"]),
  // Afterglow — Neon Fields
  T("afterglow-night-drive", "Night Drive Electric", "neon-fields", "afterglow", 5, 90, ["night", "dance"]),
  T("afterglow-afterglow", "Afterglow", "neon-fields", "afterglow", 6, 95, ["chill", "golden"]),
  T("afterglow-golden-hour", "Golden Hour Avenue", "neon-fields", "afterglow", 7, 82, ["golden", "chill"]),
  T("afterglow-palm-chrome", "Palm & Chrome", "neon-fields", "afterglow", 8, 71, ["dance", "night"]),
  // Midnight Meridian — Sable & Ash
  T("mm-meridian", "Meridian", "sable-ash", "midnight-meridian", 9, 85, ["indie", "night"]),
  T("mm-borrowed-light", "Borrowed Light", "sable-ash", "midnight-meridian", 10, 88, ["indie", "dream"]),
  T("mm-cinder-stone", "Cinder & Stone", "sable-ash", "midnight-meridian", 11, 66, ["indie", "rock"]),
  T("mm-long-way-home", "The Long Way Home", "sable-ash", "midnight-meridian", 12, 79, ["indie", "chill"]),
  // Tidal — The Glass Harbor
  T("tidal-tidekeeper", "Tidekeeper", "glass-harbor", "tidal", 13, 76, ["ambient", "chill"]),
  T("tidal-glass-harbor", "Glass Harbor", "glass-harbor", "tidal", 14, 84, ["ambient", "dream"]),
  T("tidal-undertow", "Undertow", "glass-harbor", "tidal", 15, 69, ["ambient", "chill"]),
  T("tidal-harbor-lights", "Harbor Lights", "glass-harbor", "tidal", 16, 81, ["ambient", "night"]),
  // Summer Static — Cassette Coast
  T("ss-polaroid-rain", "Polaroid Rain", "cassette-coast", "summer-static", 1, 83, ["dream", "golden"]),
  T("ss-peach-soda", "Peach Soda", "cassette-coast", "summer-static", 2, 77, ["golden", "chill"]),
  T("ss-boardwalk-echo", "Boardwalk Echo", "cassette-coast", "summer-static", 3, 72, ["dream", "dance"]),
  T("ss-sunburn-heart", "Sunburn Heart", "cassette-coast", "summer-static", 4, 80, ["dream", "chill"]),
  // Streetlights — Nocturne City
  T("sl-neon-rain", "Neon Rain", "nocturne-city", "streetlights", 5, 86, ["lo-fi", "night"]),
  T("sl-paper-lanterns", "Paper Lanterns", "nocturne-city", "streetlights", 6, 73, ["lo-fi", "chill"]),
  T("sl-midnight-courier", "Midnight Courier", "nocturne-city", "streetlights", 7, 89, ["lo-fi", "night"]),
  T("sl-streetlight-static", "Streetlight Static", "nocturne-city", "streetlights", 8, 75, ["lo-fi", "dream"]),
  // Polarize — Aurora Motive
  T("aur-polarize", "Polarize", "aurora-motive", "polarize", 2, 96, ["synth", "dance"]),
  T("aur-glass-cathedral", "Glass Cathedral", "aurora-motive", "polarize", 7, 88, ["synth", "night"]),
  T("aur-static-bloom", "Static Bloom", "aurora-motive", "polarize", 11, 84, ["synth", "dream"]),
  T("aur-northern-wire", "Northern Wire", "aurora-motive", "polarize", 14, 79, ["electronic", "chill"]),
  // Gold Wiring — Velvet Antenna
  T("va-gold-wiring", "Gold Wiring", "velvet-antenna", "gold-wiring", 3, 93, ["funk", "groove"]),
  T("va-pocket-funk", "Pocket Funk", "velvet-antenna", "gold-wiring", 8, 86, ["funk", "dance"]),
  T("va-brass-knuckles", "Brass Knuckles", "velvet-antenna", "gold-wiring", 12, 80, ["funk", "energy"]),
  T("va-slow-tremble", "Slow Tremble", "velvet-antenna", "gold-wiring", 15, 72, ["groove", "chill"]),
  // Cartography — Paper Jupiter
  T("pj-cartography", "Cartography", "paper-jupiter", "cartography", 4, 87, ["folk", "dream"]),
  T("pj-map-of-june", "Map of June", "paper-jupiter", "cartography", 9, 83, ["folk", "golden"]),
  T("pj-papercuts", "Papercuts", "paper-jupiter", "cartography", 13, 77, ["folk", "chill"]),
  T("pj-cedar-lines", "Cedar Lines", "paper-jupiter", "cartography", 16, 74, ["folk", "dream"]),
  // Fault Lines — Iron Meridian
  T("im-fault-lines", "Fault Lines", "iron-meridian", "fault-lines", 5, 91, ["rock", "energy"]),
  T("im-wolf-hour", "The Wolf Hour", "iron-meridian", "fault-lines", 10, 85, ["rock", "night"]),
  T("im-reverb-riot", "Reverb Riot", "iron-meridian", "fault-lines", 1, 78, ["rock", "dance"]),
  T("im-quiet-ammunition", "Quiet Ammunition", "iron-meridian", "fault-lines", 6, 70, ["rock", "indie"]),
  // Halo Signal — Lumen Vale
  T("lv-halo-signal", "Halo Signal", "lumen-vale", "halo-signal", 6, 90, ["electronic", "ethereal"]),
  T("lv-slow-glow", "Slow Glow", "lumen-vale", "halo-signal", 2, 82, ["electronic", "dream"]),
  T("lv-glass-tide", "Glass Tide", "lumen-vale", "halo-signal", 10, 76, ["ambient", "dream"]),
  T("lv-lullaby-circuit", "Lullaby Circuit", "lumen-vale", "halo-signal", 13, 71, ["electronic", "chill"]),
  // Low Light Theory — Sundial Theory
  T("slt-blue-hour", "Blue Hour", "sundial-theory", "low-light-theory", 8, 89, ["soul", "jazz"]),
  T("slt-brass-rain", "Brass Rain", "sundial-theory", "low-light-theory", 3, 81, ["soul", "groove"]),
  T("slt-monsoon-swing", "Monsoon Swing", "sundial-theory", "low-light-theory", 11, 75, ["jazz", "dance"]),
  T("slt-sunfall-studies", "Sunfall Studies", "sundial-theory", "low-light-theory", 16, 73, ["soul", "chill"]),
];

// --- curated mixes ----------------------------------------------------------

export const MIXES: Mix[] = [
  {
    id: "mix-focus",
    title: "Focus Flow",
    description: "Ambient and dream states for deep work.",
    gradient: ["#0d9488", "#1e1b4b"],
    trackIds: ["tidal-tidekeeper", "tidal-harbor-lights", "mm-borrowed-light", "sl-paper-lanterns", "ss-polaroid-rain", "tidal-undertow"],
  },
  {
    id: "mix-night",
    title: "Night Drive",
    description: "Synth and lo-fi for the city after dark.",
    gradient: ["#2563eb", "#0f172a"],
    trackIds: ["sl-midnight-courier", "afterglow-night-drive", "sl-neon-rain", "prism-lucid-skyline", "mm-meridian", "afterglow-palm-chrome", "tidal-harbor-lights"],
  },
  {
    id: "mix-golden",
    title: "Golden Hour",
    description: "Warm, hazy tracks for the end of the day.",
    gradient: ["#ea580c", "#4c0519"],
    trackIds: ["afterglow-afterglow", "ss-peach-soda", "ss-polaroid-rain", "afterglow-golden-hour", "ss-sunburn-heart", "mm-long-way-home"],
  },
  {
    id: "mix-soft",
    title: "Soft Focus",
    description: "Slow-burn indie and dream pop, no edges.",
    gradient: ["#7c3aed", "#082f49"],
    trackIds: ["mm-borrowed-light", "tidal-glass-harbor", "ss-sunburn-heart", "mm-long-way-home", "prism-fall", "ss-polaroid-rain"],
  },
  {
    id: "mix-top",
    title: "This Week's Top Tracks",
    description: "The most played songs across the SoundCore catalog.",
    gradient: ["#e11d48", "#7c3aed"],
    trackIds: [
      "aur-polarize", "afterglow-afterglow", "prism-chromatic", "va-gold-wiring",
      "afterglow-night-drive", "im-fault-lines", "sl-midnight-courier", "lv-halo-signal",
      "mm-borrowed-light", "prism-lucid-skyline", "slt-blue-hour", "sl-neon-rain",
    ],
  },
  {
    id: "mix-on-repeat",
    title: "On Repeat",
    description: "High-energy dance and synth that loop forever.",
    gradient: ["#16a34a", "#065f46"],
    trackIds: ["prism-chromatic", "afterglow-night-drive", "prism-velvet-static", "prism-lucid-skyline", "ss-boardwalk-echo", "afterglow-palm-chrome", "sl-neon-rain"],
  },
  {
    id: "mix-fresh",
    title: "Fresh Finds",
    description: "New releases lighting up the SoundCore catalog.",
    gradient: ["#a21caf", "#312e81"],
    trackIds: [
      "aur-polarize", "va-gold-wiring", "im-fault-lines", "lv-halo-signal",
      "slt-blue-hour", "pj-cartography", "aur-glass-cathedral", "va-pocket-funk",
    ],
  },
  {
    id: "mix-groove",
    title: "Groove Theory",
    description: "Funk, soul and swing with a modern pulse.",
    gradient: ["#eab308", "#7c2d12"],
    trackIds: [
      "va-gold-wiring", "va-pocket-funk", "slt-brass-rain", "slt-monsoon-swing",
      "va-brass-knuckles", "va-slow-tremble",
    ],
  },
];

// --- lookup helpers ----------------------------------------------------------

export const artistById = (id: string): Artist => ARTISTS.find((a) => a.id === id) ?? ARTISTS[0];
export const albumById = (id: string): Album => ALBUMS.find((a) => a.id === id) ?? ALBUMS[0];
export const trackById = (id: string): Track | undefined => TRACKS.find((t) => t.id === id);

export const albumTracks = (albumId: string): Track[] => TRACKS.filter((t) => t.albumId === albumId);
export const artistTracks = (artistId: string): Track[] => TRACKS.filter((t) => t.artistId === artistId);
export const tracksByIds = (ids: string[]): Track[] =>
  ids.map((id) => trackById(id)).filter((t): t is Track => t !== undefined);

export const topTracks = (n: number): Track[] =>
  [...TRACKS].sort((a, b) => b.popularity - a.popularity).slice(0, n);

export const albumsByNewest = (): Album[] =>
  [...ALBUMS].sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

export interface SearchResults {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

export function searchCatalog(query: string): SearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return { tracks: [], albums: [], artists: [] };
  const includes = (s: string) => s.toLowerCase().includes(q);

  const tracks = TRACKS.filter(
    (t) =>
      includes(t.title) ||
      includes(artistById(t.artistId).name) ||
      includes(albumById(t.albumId).title) ||
      t.moods.some(includes),
  ).sort((a, b) => b.popularity - a.popularity);

  const albums = ALBUMS.filter(
    (a) => includes(a.title) || includes(artistById(a.artistId).name),
  );

  const artists = ARTISTS.filter((a) => includes(a.name) || a.bio.toLowerCase().includes(q));

  return { tracks, albums, artists };
}

export const totalCatalogDuration = (): number =>
  TRACKS.reduce((sum, t) => sum + t.duration, 0);