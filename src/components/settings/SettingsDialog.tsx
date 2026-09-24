import { Button } from "@/components/ui/button";
import { ImportSection } from "@/components/settings/ImportSection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  applyEqPreset,
  setAudioFilter,
  setEqBalance,
  setEqBass,
  setEqMono,
  setEqTreble,
  type AudioFilterId,
  AUDIO_FILTERS,
} from "@/lib/audio";
import { useAuth } from "@/hooks/use-auth";
import { clearPlayHistory, usePlayerStore } from "@/store/player";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Check,
  Film,
  Gauge,
  ImageOff,
  ImagePlus,
  Keyboard,
  Loader2,
  LogOut,
  Moon,
  Palette,
  Pencil,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  deleteAllWallpaperFiles,
  deleteWallpaperFile,
  getImageWallpaperUrl,
  getLiveWallpaperUrl,
  getWallpaperKey,
  getWallpaperUrl,
  listWallpaperFiles,
  saveWallpaperLibraryFile,
  wallpaperKind,
  wallpaperMarker,
  type StoredWallpaper,
  type WallpaperKind,
  IMAGE_WALLPAPER_KEY,
  LIVE_WALLPAPER_KEY,
  IMAGE_WALLPAPER_MARKER,
  LIVE_WALLPAPER_MARKER,
} from "@/lib/wallpaperStorage";

const MAX_WALLPAPER_BYTES = 100_000_000;
const MAX_LIVE_WALLPAPER_BYTES = 100_000_000;

type WallpaperLibraryEntry = StoredWallpaper & { url: string; kind: WallpaperKind };

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Seek ±5s"],
  ["↑ / ↓", "Volume"],
  ["N / P", "Next / previous"],
  ["S", "Shuffle"],
  ["R", "Repeat"],
  ["M", "Mute"],
  ["Q", "Queue"],
  ["F", "Full-screen player"],
  ["L", "Like current song"],
  ["/", "Search"],
];

export function SettingsDialog({
  open,
  onOpenChange,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the user signs out (navigates away from the app). */
  onSignOut?: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const updateName = useMutation(api.users.updateName);
  const updateImage = useMutation(api.users.updateImage);
  const clearHistory = useMutation(api.history.clearHistory);

  const rate = usePlayerStore((s) => s.rate);
  const setRate = usePlayerStore((s) => s.setRate);
  const autoplay = usePlayerStore((s) => s.autoplay);
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
  const videoEnabled = usePlayerStore((s) => s.videoEnabled);
  const toggleVideo = usePlayerStore((s) => s.toggleVideo);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const accentTheme = usePlayerStore((s) => s.accentTheme);
  const setAccentTheme = usePlayerStore((s) => s.setAccentTheme);
  const compactMode = usePlayerStore((s) => s.compactMode);
  const toggleCompactMode = usePlayerStore((s) => s.toggleCompactMode);
  const ambientGlow = usePlayerStore((s) => s.ambientGlow);
  const toggleAmbientGlow = usePlayerStore((s) => s.toggleAmbientGlow);
  const visualizerEnabled = usePlayerStore((s) => s.visualizerEnabled);
  const toggleVisualizer = usePlayerStore((s) => s.toggleVisualizer);
  const pointerEffects = usePlayerStore((s) => s.pointerEffects);
  const togglePointerEffects = usePlayerStore((s) => s.togglePointerEffects);
  const themeMode = usePlayerStore((s) => s.themeMode);
  const setThemeMode = usePlayerStore((s) => s.setThemeMode);
  const hideExplicit = usePlayerStore((s) => s.hideExplicit);
  const toggleHideExplicit = usePlayerStore((s) => s.toggleHideExplicit);
  const liquidGlass = usePlayerStore((s) => s.liquidGlass);
  const toggleLiquidGlass = usePlayerStore((s) => s.toggleLiquidGlass);
  const wallpaper = usePlayerStore((s) => s.wallpaper);
  const wallpaperType = usePlayerStore((s) => s.wallpaperType);
  const setWallpaper = usePlayerStore((s) => s.setWallpaper);
  const setWallpaperType = usePlayerStore((s) => s.setWallpaperType);
  const hideSidebarEmail = usePlayerStore((s) => s.hideSidebarEmail);
  const toggleHideSidebarEmail = usePlayerStore((s) => s.toggleHideSidebarEmail);

  const [name, setName] = useState("");
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const liveWallpaperInputRef = useRef<HTMLInputElement>(null);
  const [liveWallpaperFileName, setLiveWallpaperFileName] = useState("");
  const [wallpaperLibrary, setWallpaperLibrary] = useState<WallpaperLibraryEntry[]>([]);
  const [activeWallpaperKey, setActiveWallpaperKey] = useState<string | null>(() =>
    getWallpaperKey(localStorage.getItem("ss.wallpaper")),
  );
  const wallpaperLibraryUrlsRef = useRef<string[]>([]);
  const [liveWallpaperUrl, setLiveWallpaperUrl] = useState(() => {
    const saved = localStorage.getItem("ss.wallpaper");
    return localStorage.getItem("ss.wallpaperType") === "video" && saved?.startsWith("http")
      ? saved
      : "";
  });
  const [wallpaperBlur, setWallpaperBlur] = useState(
    () => localStorage.getItem("ss.wallpaperBlur") !== "0",
  );

  const loadWallpaperLibrary = useCallback(async () => {
    const records = await listWallpaperFiles();
    const current = usePlayerStore.getState().wallpaper;
    const activeKey = getWallpaperKey(localStorage.getItem("ss.wallpaper"));
    const next = records.map((record) => ({
      ...record,
      kind: wallpaperKind(record),
      url: activeKey === record.key && current?.startsWith("blob:")
        ? current
        : URL.createObjectURL(record.blob),
    }));
    wallpaperLibraryUrlsRef.current.forEach((url) => {
      if (url !== current) URL.revokeObjectURL(url);
    });
    wallpaperLibraryUrlsRef.current = next.map((entry) => entry.url);
    setWallpaperLibrary(next);
    setActiveWallpaperKey(getWallpaperKey(localStorage.getItem("ss.wallpaper")));
  }, []);

  useEffect(() => {
    if (open) void loadWallpaperLibrary().catch(() => toast.error("Couldn't load saved wallpapers"));
  }, [open, loadWallpaperLibrary]);

  useEffect(() => {
    return () => {
      const current = usePlayerStore.getState().wallpaper;
      wallpaperLibraryUrlsRef.current.forEach((url) => {
        if (url !== current) URL.revokeObjectURL(url);
      });
    };
  }, []);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Audio settings — persisted locally, applied live to the Web Audio graph.
  const [eq, setEq] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("ss.eq") ?? "{}") as {
        bass?: number;
        treble?: number;
        balance?: number;
        mono?: boolean;
        filter?: AudioFilterId;
      };
    } catch {
      return {};
    }
  });
  const persistEq = (next: typeof eq) => {
    setEq(next);
    try {
      localStorage.setItem("ss.eq", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  // Keep the editable name in sync with the user. The reset is keyed by the
  // dialog OPENING (not by an in-render setState) and happens in the same
  // effect that reacts to the user changing, so no cascading render is
  // triggered from the effect body itself.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setName(user?.name ?? ""));
    return () => cancelAnimationFrame(id);
  }, [open, user?.name]);

  const displayName =
    user?.name ?? (user?.isAnonymous ? "Guest" : "Listener");
  const avatarInitials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name can't be empty");
      return;
    }
    if (trimmed === displayName) return;
    setSaving(true);
    try {
      await updateName({ name: trimmed });
      toast.success(`You're now known as ${trimmed}`);
    } catch {
      toast.error("Couldn't save your name — try again");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    if (!onSignOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  const handleClearHistory = async () => {
    setClearing(true);
    try {
      const n = await clearHistory({});
      clearPlayHistory();
      toast.success(`Cleared ${n} ${n === 1 ? "entry" : "entries"} from your history`);
    } catch {
      toast.error("Couldn't clear history — try again");
    } finally {
      setClearing(false);
    }
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file for your profile picture");
      return;
    }
    if (file.size > 700_000) {
      toast.error("Profile picture must be smaller than 700 KB");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== "string") {
        toast.error("Couldn't read that image");
        return;
      }
      setSavingAvatar(true);
      try {
        await updateImage({ image: reader.result });
        toast.success("Profile picture updated");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't update your profile picture");
      } finally {
        setSavingAvatar(false);
      }
    };
    reader.onerror = () => toast.error("Couldn't read that image");
    reader.readAsDataURL(file);
  };

  const clearAvatar = async () => {
    setSavingAvatar(true);
    try {
      await updateImage({});
      toast("Profile picture removed");
    } catch {
      toast.error("Couldn't remove your profile picture");
    } finally {
      setSavingAvatar(false);
    }
  };

  const applyLiveWallpaper = () => {
    const value = liveWallpaperUrl.trim();
    if (!value) {
      toast.error("Paste a video URL first");
      return;
    }
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      toast.error("Use a valid http(s) video URL");
      return;
    }
    setWallpaper(value, "video");
    localStorage.setItem("ss.savedVideoUrl", value);
    toast.success("Live wallpaper applied");
  };

  const handleLiveWallpaperFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Choose a video file for your live wallpaper");
      return;
    }
    if (file.size > MAX_LIVE_WALLPAPER_BYTES) {
      toast.error("Live wallpaper videos must be smaller than 100 MB");
      return;
    }

    try {
      const record = await saveWallpaperLibraryFile(file);
      const url = await getWallpaperUrl(record.key);
      if (!url) throw new Error("Wallpaper file was not found after saving");
      if (wallpaper?.startsWith("blob:") && !wallpaperLibraryUrlsRef.current.includes(wallpaper)) {
        URL.revokeObjectURL(wallpaper);
      }
      setWallpaper(url, "video");
      localStorage.setItem("ss.wallpaper", wallpaperMarker(record.key));
      setActiveWallpaperKey(record.key);
      setLiveWallpaperFileName(file.name);
      setLiveWallpaperUrl("");
      await loadWallpaperLibrary();
      toast.success("Live wallpaper saved to your library");
    } catch {
      toast.error("Couldn't save that video — try a smaller file");
    }
  };

  const handleWallpaperChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file for your wallpaper");
      return;
    }
    if (file.size > MAX_WALLPAPER_BYTES) {
      toast.error("Wallpapers must be smaller than 100 MB");
      return;
    }

    void saveWallpaperLibraryFile(file)
      .then(async (record) => {
        const url = await getWallpaperUrl(record.key);
        if (!url) throw new Error("Wallpaper file was not found after saving");
        if (wallpaper?.startsWith("blob:") && !wallpaperLibraryUrlsRef.current.includes(wallpaper)) {
          URL.revokeObjectURL(wallpaper);
        }
        setWallpaper(url, "image");
        localStorage.setItem("ss.wallpaper", wallpaperMarker(record.key));
        setActiveWallpaperKey(record.key);
        await loadWallpaperLibrary();
        toast.success("Wallpaper saved to your library");
      })
      .catch(() => {
        toast.error("Couldn't save that image — try a smaller file");
      });
  };

  const activateWallpaperEntry = (entry: WallpaperLibraryEntry) => {
    if (wallpaper?.startsWith("blob:") && !wallpaperLibraryUrlsRef.current.includes(wallpaper)) {
      URL.revokeObjectURL(wallpaper);
    }
    setWallpaper(entry.url, entry.kind);
    localStorage.setItem("ss.wallpaper", wallpaperMarker(entry.key));
    setActiveWallpaperKey(entry.key);
    toast.success(`${entry.name} applied`);
  };

  const removeWallpaperEntry = async (entry: WallpaperLibraryEntry) => {
    await deleteWallpaperFile(entry.key);
    if (wallpaperLibraryUrlsRef.current.includes(entry.url)) {
      URL.revokeObjectURL(entry.url);
      wallpaperLibraryUrlsRef.current = wallpaperLibraryUrlsRef.current.filter((url) => url !== entry.url);
    }
    if (activeWallpaperKey === entry.key) {
      setWallpaper(null, entry.kind);
      setActiveWallpaperKey(null);
      localStorage.removeItem("ss.wallpaper");
    }
    await loadWallpaperLibrary();
    toast.success(`${entry.name} removed`);
  };

  const clearWallpaper = () => {
    if (wallpaper?.startsWith("blob:") && !wallpaperLibraryUrlsRef.current.includes(wallpaper)) {
      URL.revokeObjectURL(wallpaper);
    }
    wallpaperLibraryUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    wallpaperLibraryUrlsRef.current = [];
    setWallpaperLibrary([]);
    setActiveWallpaperKey(null);
    void deleteAllWallpaperFiles();
    localStorage.removeItem("ss.savedImageWallpaper");
    localStorage.removeItem("ss.savedVideoUrl");
    setWallpaper(null, wallpaperType);
    setLiveWallpaperFileName("");
    toast("Wallpaper library removed");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card !fixed max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Settings</DialogTitle>
          <DialogDescription>
            Profile, playback and data preferences.
          </DialogDescription>
        </DialogHeader>

        {/* profile */}
        <section className="flex flex-col gap-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            <UserRound className="size-3.5" />
            Profile
          </p>
          <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="group relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[rgb(var(--tint))] text-lg font-bold text-black ring-2 ring-white/10 transition-transform hover:scale-105"
              aria-label="Change profile picture"
            >
              {user?.image ? (
                <img src={user.image} alt="Your profile picture" className="size-full object-cover" />
              ) : (
                <span>{avatarInitials}</span>
              )}
              {savingAvatar && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                  <Loader2 className="size-5 animate-spin text-white" />
                </span>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Profile picture</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Choose a square image for your avatar across the app.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={savingAvatar}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold transition-colors hover:border-white/25 hover:bg-white/[0.1] disabled:opacity-50"
                >
                  Change photo
                </button>
                {user?.image && (
                  <button
                    type="button"
                    onClick={() => void clearAvatar()}
                    disabled={savingAvatar}
                    className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-red-400/30 hover:text-red-300 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Pencil className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={displayName}
                maxLength={40}
                className="pl-9"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !saving) void saveName();
                }}
              />
            </div>
            <Button
              size="icon"
              onClick={() => void saveName()}
              disabled={saving || !name.trim() || name.trim() === displayName}
              aria-label="Save name"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{displayName}</span>
            {user?.email ? ` · ${user.email}` : ""}
          </p>
          {onSignOut && (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="flex items-center gap-2 self-start rounded-full border border-white/10 px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-red-500/40 hover:bg-red-500/[0.08] hover:text-red-400 disabled:opacity-50"
            >
              {signingOut ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LogOut className="size-3.5" />
              )}
              Sign out
            </button>
          )}
          {user?.email && (
            <ToggleRow
              label="Hide email in sidebar"
              description="Show only your name in the corner account panel"
              on={hideSidebarEmail}
              onToggle={() => {
                toggleHideSidebarEmail();
                toast(hideSidebarEmail ? "Email shown in sidebar" : "Email hidden in sidebar");
              }}
            />
          )}
        </section>

        <Separator className="bg-white/[0.07]" />

        {/* playback */}
        <section className="flex flex-col gap-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            <Gauge className="size-3.5" />
            Playback
          </p>

          <ToggleRow
            label="Video in full-screen player"
            description="Show the music video when maximizing"
            on={videoEnabled}
            onToggle={() => {
              toggleVideo();
              toast(videoEnabled ? "Video off" : "Video on");
            }}
          />
          <ToggleRow
            label="Shuffle by default"
            description="Start queues shuffled"
            on={shuffle}
            onToggle={toggleShuffle}
          />

          {/* default playback speed */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Default speed</p>
              <p className="text-xs text-muted-foreground">
                Applies to new tracks
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {[0.75, 1, 1.25, 1.5].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRate(r)}
                  className={cn(
                    "rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums transition-colors",
                    rate === r
                      ? "bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
                      : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                  )}
                >
                  {r}×
                </button>
              ))}
            </div>
          </div>
        </section>

        <Separator className="bg-white/[0.07]" />

        {/* audio */}
        <section className="flex flex-col gap-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            <SlidersHorizontal className="size-3.5" />
            Audio
          </p>

          {/* presets */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "Flat", bass: 0, treble: 0 },
              { label: "Bass Boost", bass: 10, treble: 0 },
              { label: "Treble Boost", bass: 0, treble: 8 },
              { label: "Vocal", bass: -3, treble: 5 },
              { label: "Rock", bass: 5, treble: 4 },
              { label: "Pop", bass: 3, treble: 3 },
              { label: "Classical", bass: 1, treble: 2 },
              { label: "Electronic", bass: 8, treble: 3 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  applyEqPreset({ bass: p.bass, treble: p.treble });
                  persistEq({ ...eq, bass: p.bass, treble: p.treble });
                  toast(`EQ preset: ${p.label}`);
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  eq.bass === p.bass && eq.treble === p.treble
                    ? "border-transparent bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
                    : "border-white/10 text-muted-foreground hover:border-white/30 hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* bass */}
          <EqSlider
            label="Bass"
            value={eq.bass ?? 0}
            onChange={(v) => {
              setEqBass(v);
              persistEq({ ...eq, bass: v });
            }}
          />
          <EqSlider
            label="Treble"
            value={eq.treble ?? 0}
            onChange={(v) => {
              setEqTreble(v);
              persistEq({ ...eq, treble: v });
            }}
          />
          <EqSlider
            label="Balance"
            min={-1}
            max={1}
            step={0.1}
            value={eq.balance ?? 0}
            format={(v) => (v === 0 ? "Center" : v < 0 ? `L ${Math.round(-v * 100)}%` : `R ${Math.round(v * 100)}%`)}
            onChange={(v) => {
              setEqBalance(v);
              persistEq({ ...eq, balance: v });
            }}
          />

          <ToggleRow
            label="Mono audio"
            description="Same signal in both ears — good for single-ear listening"
            on={eq.mono ?? false}
            onToggle={() => {
              const next = !(eq.mono ?? false);
              setEqMono(next);
              persistEq({ ...eq, mono: next });
            }}
          />

          {/* live sound filters (8D etc.) */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            <p className="text-sm font-medium">Sound effects</p>
            <p className="text-xs text-muted-foreground">Applies to what's playing right now</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {AUDIO_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    if (setAudioFilter(f.id)) persistEq({ ...eq, filter: f.id });
                    else toast.error("Effects need a browser with Web Audio");
                  }}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    (eq.filter ?? "off") === f.id
                      ? "border-transparent bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
                      : "border-white/10 text-muted-foreground hover:border-white/30 hover:text-foreground",
                  )}
                >
                  <span>{f.icon}</span>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <Separator className="bg-white/[0.07]" />

        {/* appearance */}
        <section className="flex flex-col gap-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            <Palette className="size-3.5" />
            Appearance
          </p>

          {/* accent color */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Accent color</p>
                <p className="text-xs text-muted-foreground">
                  Tints buttons, highlights and the ambient glow
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {(
                [
                  { id: "auto", label: "Auto", swatch: "linear-gradient(135deg,#f472b6,#60a5fa,#a3e635)" },
                  { id: "lime", label: "Lime", swatch: "rgb(203 244 143)" },
                  { id: "violet", label: "Violet", swatch: "rgb(167 139 250)" },
                  { id: "blue", label: "Blue", swatch: "rgb(96 165 250)" },
                  { id: "rose", label: "Rose", swatch: "rgb(251 113 133)" },
                  { id: "amber", label: "Amber", swatch: "rgb(251 191 36)" },
                  { id: "teal", label: "Teal", swatch: "rgb(45 212 191)" },
                  { id: "orange", label: "Orange", swatch: "rgb(251 146 60)" },
                ] as const
              ).map(({ id, label, swatch }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  onClick={() => setAccentTheme(id)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-all",
                    accentTheme === id
                      ? "border-white/60 bg-white/[0.1] text-foreground"
                      : "border-white/10 text-muted-foreground hover:border-white/30",
                  )}
                >
                  <span
                    className="size-4 rounded-full ring-1 ring-white/20"
                    style={{ background: swatch }}
                  />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* theme mode */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            <p className="text-sm font-medium">Theme</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {([
                { id: "dark", label: "Dark" },
                { id: "light", label: "Light" },
                { id: "amoled", label: "AMOLED" },
              ] as const).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setThemeMode(id)}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors",
                    themeMode === id
                      ? "border-[rgb(var(--tint))] bg-[rgb(var(--tint)_/_0.14)] text-[rgb(var(--tint))]"
                      : "border-white/10 text-muted-foreground hover:border-white/30 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* personal wallpaper */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            <div className="flex items-center gap-3">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/20">
                {wallpaper && wallpaperType === "video" && wallpaper !== LIVE_WALLPAPER_MARKER ? (
                  <video src={wallpaper} muted loop autoPlay playsInline className="size-full object-cover" />
                ) : wallpaper && wallpaper !== LIVE_WALLPAPER_MARKER && wallpaper !== IMAGE_WALLPAPER_MARKER ? (
                  <img src={wallpaper} alt="Wallpaper preview" className="size-full object-cover" />
                ) : (
                  <ImagePlus className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">Personal wallpaper</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {wallpaperType === "video"
                    ? "A looping video sits behind the app with a soft blur and dark glass overlay."
                    : "Your image sits behind the app with a soft blur and dark glass overlay."}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-lg border border-white/[0.07] bg-black/10 p-1">
              {(["image", "video"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    if (type === wallpaperType) return;
                    const hasVideoWallpaper = Boolean(
                      wallpaper &&
                        (wallpaper.startsWith("http") ||
                          wallpaper.startsWith("blob:") ||
                          wallpaper.startsWith("data:video/") ||
                          wallpaper === LIVE_WALLPAPER_MARKER),
                    );
                    if (type === "video") {
                      const savedEntry = wallpaperLibrary.find((entry) => entry.kind === "video");
                      if (savedEntry) {
                        activateWallpaperEntry(savedEntry);
                        return;
                      }
                      // Restore the legacy single uploaded file when switching
                      // back from Photo; switching modes never deletes it.
                      void getLiveWallpaperUrl().then((url) => {
                        if (url) {
                          if (wallpaper?.startsWith("blob:") && !wallpaperLibraryUrlsRef.current.includes(wallpaper)) {
                            URL.revokeObjectURL(wallpaper);
                          }
                          setWallpaper(url, "video");
                          localStorage.setItem("ss.wallpaper", LIVE_WALLPAPER_MARKER);
                          setActiveWallpaperKey(LIVE_WALLPAPER_KEY);
                          return;
                        }
                        if (wallpaper && !hasVideoWallpaper && !wallpaper.startsWith("blob:")) {
                          localStorage.setItem("ss.savedImageWallpaper", wallpaper);
                        }
                        if (wallpaper && !hasVideoWallpaper) {
                          setWallpaper(null, "video");
                        } else {
                          const savedVideoUrl = localStorage.getItem("ss.savedVideoUrl");
                          if (savedVideoUrl) setWallpaper(savedVideoUrl, "video");
                          else setWallpaperType("video");
                        }
                      }).catch(() => {
                        if (wallpaper && !hasVideoWallpaper) setWallpaper(null, "video");
                        else setWallpaperType("video");
                      });
                    } else {
                      const savedEntry = wallpaperLibrary.find((entry) => entry.kind === "image");
                      if (savedEntry) {
                        activateWallpaperEntry(savedEntry);
                        return;
                      }
                      // Restore the legacy single image file when switching back
                      // from Live video.
                      void getImageWallpaperUrl().then((url) => {
                        if (url) {
                          if (wallpaper?.startsWith("blob:") && !wallpaperLibraryUrlsRef.current.includes(wallpaper)) {
                            URL.revokeObjectURL(wallpaper);
                          }
                          setWallpaper(url, "image");
                          localStorage.setItem("ss.wallpaper", IMAGE_WALLPAPER_MARKER);
                          setActiveWallpaperKey(IMAGE_WALLPAPER_KEY);
                          return;
                        }
                        const savedImage = localStorage.getItem("ss.savedImageWallpaper");
                        if (savedImage) setWallpaper(savedImage, "image");
                        else if (wallpaper && hasVideoWallpaper) setWallpaper(null, "image");
                        else setWallpaperType("image");
                      }).catch(() => {
                        if (wallpaper && hasVideoWallpaper) setWallpaper(null, "image");
                        else setWallpaperType("image");
                      });
                    }
                  }}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors",
                    wallpaperType === type
                      ? "bg-white/[0.1] text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {type === "image" ? "Photo" : "Live video"}
                </button>
              ))}
            </div>

            {wallpaperType === "image" ? (
              <>
                <input
                  ref={wallpaperInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  className="hidden"
                  onChange={handleWallpaperChange}
                />
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => wallpaperInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-white/25 hover:bg-white/[0.1]"
                  >
                    <ImagePlus className="size-3.5" />
                    {wallpaper ? "Add another image" : "Choose image"}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">PNG, JPG, WebP or AVIF · up to 100 MB</p>
              </>
            ) : (
              <>
                <div className="mt-2.5 flex gap-2">
                  <Input
                    value={liveWallpaperUrl}
                    onChange={(event) => setLiveWallpaperUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyLiveWallpaper();
                    }}
                    placeholder="https://.../wallpaper.mp4"
                    aria-label="Live wallpaper video URL"
                    className="min-w-0 text-xs"
                  />
                  <Button size="sm" onClick={applyLiveWallpaper} className="shrink-0">
                    <Film className="size-3.5" />
                    Apply
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  Use a direct MP4/WebM URL, or choose a video file from your device.
                </p>
                <input
                  ref={liveWallpaperInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/ogg"
                  className="hidden"
                  onChange={handleLiveWallpaperFileChange}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => liveWallpaperInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-white/25 hover:bg-white/[0.1]"
                  >
                    <Film className="size-3.5" />
                    Add video file
                  </button>
                  {liveWallpaperFileName && (
                    <span className="max-w-full truncate py-1.5 text-xs text-[rgb(var(--tint))]">
                      {liveWallpaperFileName}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">MP4, WebM or OGG · up to 100 MB</p>
              </>
            )}

            {wallpaperLibrary.length > 0 && (
              <div className="mt-3 border-t border-white/[0.07] pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                    Saved wallpapers
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    {wallpaperLibrary.length} {wallpaperLibrary.length === 1 ? "file" : "files"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {wallpaperLibrary.map((entry) => {
                    const selected = activeWallpaperKey === entry.key;
                    return (
                      <div key={entry.key} className="group relative">
                        <button
                          type="button"
                          onClick={() => activateWallpaperEntry(entry)}
                          className={cn(
                            "relative aspect-square w-full overflow-hidden rounded-lg border bg-black/20 transition-all hover:scale-[1.03]",
                            selected
                              ? "border-[rgb(var(--tint))] ring-2 ring-[rgb(var(--tint)_/_0.35]"
                              : "border-white/10 hover:border-white/30",
                          )}
                          aria-label={`Use ${entry.name}`}
                        >
                          {entry.kind === "video" ? (
                            <video src={entry.url} muted loop autoPlay playsInline className="size-full object-cover" />
                          ) : (
                            <img src={entry.url} alt="" className="size-full object-cover" />
                          )}
                          {selected && (
                            <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-[rgb(var(--tint))] text-black shadow-lg">
                              <Check className="size-3" />
                            </span>
                          )}
                        </button>
                        <p className="mt-1 truncate text-[10px] text-muted-foreground" title={entry.name}>
                          {entry.name}
                        </p>
                        <button
                          type="button"
                          onClick={() => void removeWallpaperEntry(entry)}
                          className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded-full bg-black/70 text-red-300 backdrop-blur transition hover:bg-red-500/80 hover:text-white group-hover:flex"
                          aria-label={`Remove ${entry.name}`}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Click any saved wallpaper to switch instantly. Files stay in this browser.
                </p>
              </div>
            )}

            {(wallpaper || wallpaperLibrary.length > 0) && (
              <button
                type="button"
                onClick={clearWallpaper}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-red-400/30 hover:bg-red-400/[0.08] hover:text-red-300"
              >
                <ImageOff className="size-3.5" />
                Remove wallpaper library
              </button>
            )}
          </div>

          <ToggleRow
            label="Wallpaper blur"
            description="Keep the personal wallpaper softly blurred behind the UI"
            on={wallpaperBlur}
            onToggle={() => {
              const next = !wallpaperBlur;
              setWallpaperBlur(next);
              localStorage.setItem("ss.wallpaperBlur", next ? "1" : "0");
              window.dispatchEvent(new CustomEvent("ss:wallpaper-blur-change", { detail: next }));
              toast(next ? "Wallpaper blur on" : "Wallpaper blur off");
            }}
          />

          <ToggleRow
            label="Hide explicit content"
            description="Filter out tracks flagged explicit"
            on={hideExplicit}
            onToggle={() => {
              toggleHideExplicit();
              toast(hideExplicit ? "Explicit content shown" : "Explicit content hidden");
            }}
          />
          <ToggleRow
            label="Compact mode"
            description="Tighter player bar, wider content layout"
            on={compactMode}
            onToggle={() => {
              toggleCompactMode();
              toast(compactMode ? "Compact mode off" : "Compact mode on");
            }}
          />
          <ToggleRow
            label="Ambient glow"
            description="Soft colored glow at the top of the page"
            on={ambientGlow}
            onToggle={() => {
              toggleAmbientGlow();
              toast(ambientGlow ? "Ambient glow off" : "Ambient glow on");
            }}
          />
          <ToggleRow
            label="Liquid glass"
            description="Frosted, refractive panels with a moving light sheen"
            on={liquidGlass}
            onToggle={() => {
              toggleLiquidGlass();
              toast(liquidGlass ? "Liquid glass off" : "Liquid glass on");
            }}
          />
          <ToggleRow
            label="Visualizer"
            description="Animated bars that vibe with the song"
            on={visualizerEnabled}
            onToggle={() => {
              toggleVisualizer();
              toast(visualizerEnabled ? "Visualizer off" : "Visualizer on");
            }}
          />
          <ToggleRow
            label="Pointer glow"
            description="A soft liquid-glass light that follows your cursor"
            on={pointerEffects}
            onToggle={() => {
              togglePointerEffects();
              toast(pointerEffects ? "Pointer glow off" : "Pointer glow on");
            }}
          />
        </section>

        <Separator className="bg-white/[0.07]" />

        {/* personalization */}
        <section className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            <Sparkles className="size-3.5" />
            Personalization
          </p>
          <ToggleRow
            label="Autoplay"
            description="Keep playing similar music when the queue ends"
            on={autoplay}
            onToggle={() => {
              toggleAutoplay();
              toast(autoplay ? "Autoplay off" : "Autoplay on");
            }}
          />
          <p className="px-1 text-xs leading-5 text-muted-foreground">
            Home adapts to what you play: your most-heard artists shape
            recommendations, recently played fills Continue Listening, and
            Discover Weekly refreshes with a new mix for you every week.
          </p>
        </section>

        <Separator className="bg-white/[0.07]" />

        {/* keyboard shortcuts */}
        <section className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            <Keyboard className="size-3.5" />
            Keyboard shortcuts
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
            {SHORTCUTS.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 text-xs">
                <kbd className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  {key}
                </kbd>
                <span className="truncate text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <Separator className="bg-white/[0.07]" />

        {/* import */}
        <ImportSection open={open} />

        <Separator className="bg-white/[0.07]" />

        {/* data */}
        <section className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            <Moon className="size-3.5" />
            Your data
          </p>
          <button
            type="button"
            onClick={() => void handleClearHistory()}
            disabled={clearing}
            className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left text-sm transition-colors hover:border-red-500/30 hover:bg-red-500/[0.06] disabled:opacity-50"
          >
            {clearing ? (
              <Loader2 className="size-4 animate-spin text-red-400" />
            ) : (
              <Trash2 className="size-4 text-red-400" />
            )}
            <span className="min-w-0">
              <span className="block font-medium">Clear listening history</span>
              <span className="block text-xs text-muted-foreground">
                Removes recently played and most-played data. Likes and
                playlists are kept.
              </span>
            </span>
          </button>
        </section>
      </DialogContent>
    </Dialog>
  );
}

/** Labeled dB/balance slider for the audio panel. */
function EqSlider({
  label,
  value,
  onChange,
  min = -12,
  max = 12,
  step = 1,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {format ? format(value) : `${value > 0 ? "+" : ""}${value} dB`}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="mt-2"
        aria-label={label}
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  on,
  onToggle,
}: {
  label: string;
  description: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          on ? "bg-[rgb(var(--tint))]" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow transition-all",
            on ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
