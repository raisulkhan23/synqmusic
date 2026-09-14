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
import { useAuth } from "@/hooks/use-auth";
import { clearPlayHistory, usePlayerStore } from "@/store/player";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Check,
  Gauge,
  Keyboard,
  Loader2,
  LogOut,
  Moon,
  Palette,
  Pencil,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Sync the input whenever the dialog opens (or the user object changes).
  useEffect(() => {
    if (open) setName(user?.name ?? "");
  }, [open, user?.name]);

  const displayName =
    user?.name ?? (user?.isAnonymous ? "Guest" : "Listener");

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto border-white/10 bg-[#0b0c11]/95 backdrop-blur-xl">
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
            label="Visualizer"
            description="Animated bars that vibe with the song"
            on={visualizerEnabled}
            onToggle={() => {
              toggleVisualizer();
              toast(visualizerEnabled ? "Visualizer off" : "Visualizer on");
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
