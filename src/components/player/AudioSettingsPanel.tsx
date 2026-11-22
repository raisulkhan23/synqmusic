import { useEffect, useState } from "react";
import {
  AudioLines,
  Gauge,
  Headphones,
  Moon,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Slider } from "@/components/ui/slider";
import { audioGraphFailed } from "@/lib/audio";
import {
  ENHANCER_MAX,
  ENHANCER_MIN,
  EQ_MAX_DB,
  EQ_MIN_DB,
  EQ_BAND_LABELS,
  EQ_PRESETS,
  FX_MAX,
  FX_MIN,
  PITCH_MAX,
  PITCH_MIN,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
  VOLUME_GAIN_MAX,
  VOLUME_GAIN_MIN,
  formatDb,
  formatPercent,
  formatPitch,
  formatSpeed,
} from "@/lib/audioSettings";
import { formatRemaining, useSleepCountdown } from "@/lib/sleepTimer";
import { cn } from "@/lib/utils";
import { useAudioSettingsStore, syncFromEngine } from "@/store/audioSettings";
import { usePlayerStore } from "@/store/player";

/**
 * The Audio panel — SYNQ's recreation of melo's audio customization card.
 *
 * One floating card above the player bar with a section rail (Enhancer /
 * Speed & Pitch / Audio FX / Equalizer / Sleep), a reset footer and value
 * labels on every control. Every control binds to the audio settings store,
 * whose actions apply to the Web Audio engine before the UI updates — a
 * value on screen is a value the engine received, never a decorative number.
 *
 * Provider honesty: when the Web Audio graph cannot be built on this device
 * (`audioGraphFailed`), the processing controls are disabled with a banner
 * that says so instead of silently doing nothing. A YouTube track playing
 * through the IFrame engine needs no special casing here — the engine
 * notifies the player store, which re-routes the live track onto the audio
 * deck the first time any processing value changes.
 */

type SectionId = "enhancer" | "speed" | "fx" | "eq" | "sleep";

const SECTIONS: { id: SectionId; label: string; icon: typeof Gauge }[] = [
  { id: "enhancer", label: "Enhancer", icon: Headphones },
  { id: "speed", label: "Speed & Pitch", icon: Gauge },
  { id: "fx", label: "Audio FX", icon: AudioLines },
  { id: "eq", label: "Equalizer", icon: SlidersHorizontal },
  { id: "sleep", label: "Sleep", icon: Moon },
];

/** Label + value + slider row — the panel's one slider shape. */
function PanelSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("py-2", disabled && "opacity-50")}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {format(value)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        aria-label={label}
        className="mt-2"
      />
    </div>
  );
}

/** melo's pill switch — a row with a toggle on the right. */
function PanelToggle({
  label,
  description,
  on,
  onToggle,
  disabled,
}: {
  label: string;
  description?: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]",
        disabled && "opacity-50",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          on ? "bg-[rgb(var(--tint))]" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-ui",
            on ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

/** Small round chip used for EQ and enhancer presets. */
function PanelChip({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        active
          ? "border-transparent bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
          : "border-white/10 text-muted-foreground hover:border-white/30 hover:text-foreground",
        disabled && "opacity-50",
      )}
    >
      {label}
    </button>
  );
}

function SpeedPitchSection({ disabled }: { disabled: boolean }) {
  const audio = useAudioSettingsStore((s) => s.audio);
  const setSpeed = useAudioSettingsStore((s) => s.setSpeed);
  const setSpeedPitch = useAudioSettingsStore((s) => s.setSpeedPitch);
  const setPitch = useAudioSettingsStore((s) => s.setPitch);
  const setVolumeGain = useAudioSettingsStore((s) => s.setVolumeGain);
  const setRate = usePlayerStore((s) => s.setRate);

  return (
    <div className="space-y-1">
      <PanelSlider
        label="Speed"
        value={audio.speed}
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={SPEED_STEP}
        format={formatSpeed}
        disabled={disabled}
        onChange={(v) => {
          // The player store keeps the HUD-side bookkeeping (rate display,
          // ss.rate, the YouTube engine's rate). The engine writes land in
          // the same order either way, so both stores end up on v.
          setSpeed(v);
          setRate(v);
        }}
      />
      <PanelSlider
        label="Speed (pitch)"
        value={audio.speedPitch}
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={SPEED_STEP}
        format={formatSpeed}
        disabled={disabled}
        onChange={(v) => {
          // Player store FIRST (it writes the rate through the preserving
          // path), then the tape mode takes ownership — the same mutual
          // exclusion melo's two sliders apply.
          setRate(v);
          setSpeedPitch(v);
        }}
      />
      <PanelSlider
        label="Pitch"
        value={audio.pitch}
        min={PITCH_MIN}
        max={PITCH_MAX}
        step={1}
        format={formatPitch}
        disabled={disabled}
        onChange={(v) => setPitch(v)}
      />
      <PanelSlider
        label="Volume gain"
        value={audio.volumeGain}
        min={VOLUME_GAIN_MIN}
        max={VOLUME_GAIN_MAX}
        step={1}
        format={formatPercent}
        disabled={disabled}
        onChange={(v) => setVolumeGain(v)}
      />
      <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
        Speed keeps the original key; Speed (pitch) is tape-style and moves
        it. Pitch shifts ride on either one.
      </p>
    </div>
  );
}

function FxSection({ disabled }: { disabled: boolean }) {
  const audio = useAudioSettingsStore((s) => s.audio);
  const setReverb = useAudioSettingsStore((s) => s.setReverb);
  const setDistortion = useAudioSettingsStore((s) => s.setDistortion);
  const setEcho = useAudioSettingsStore((s) => s.setEcho);

  return (
    <div className="space-y-1">
      <PanelSlider
        label="Reverb"
        value={audio.reverb}
        min={FX_MIN}
        max={FX_MAX}
        step={1}
        format={formatPercent}
        disabled={disabled}
        onChange={setReverb}
      />
      <PanelSlider
        label="Distortion"
        value={audio.distortion}
        min={FX_MIN}
        max={FX_MAX}
        step={1}
        format={formatPercent}
        disabled={disabled}
        onChange={setDistortion}
      />
      <PanelSlider
        label="Echo"
        value={audio.echo}
        min={FX_MIN}
        max={FX_MAX}
        step={1}
        format={formatPercent}
        disabled={disabled}
        onChange={setEcho}
      />
    </div>
  );
}

function EqualizerSection({ disabled }: { disabled: boolean }) {
  const audio = useAudioSettingsStore((s) => s.audio);
  const setEqBass = useAudioSettingsStore((s) => s.setEqBass);
  const setEqTreble = useAudioSettingsStore((s) => s.setEqTreble);
  const setEqBand = useAudioSettingsStore((s) => s.setEqBand);
  const resetEqBands = useAudioSettingsStore((s) => s.resetEqBands);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {EQ_PRESETS.map((p) => {
          const active =
            audio.eqPreset === p.id ||
            (audio.eqBass === p.bass && audio.eqTreble === p.treble);
          return (
            <PanelChip
              key={p.id}
              label={p.label}
              active={active}
              disabled={disabled}
              onClick={() =>
                useAudioSettingsStore.getState().setEqPreset(p.id)
              }
            />
          );
        })}
      </div>

      {/* melo's three-row EQ: Low and High are SYNQ's bass/treble shelves;
          Mid is the 1 kHz band of the same 10-band curve shown below, so the
          two views of it can never disagree. */}
      <PanelSlider
        label="Low"
        value={audio.eqBass}
        min={EQ_MIN_DB}
        max={EQ_MAX_DB}
        step={1}
        format={formatDb}
        disabled={disabled}
        onChange={setEqBass}
      />
      <PanelSlider
        label="Mid"
        value={audio.eqBands[5] ?? 0}
        min={EQ_MIN_DB}
        max={EQ_MAX_DB}
        step={1}
        format={formatDb}
        disabled={disabled}
        onChange={(v) => setEqBand(5, v)}
      />
      <PanelSlider
        label="High"
        value={audio.eqTreble}
        min={EQ_MIN_DB}
        max={EQ_MAX_DB}
        step={1}
        format={formatDb}
        disabled={disabled}
        onChange={setEqTreble}
      />

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">10-band equalizer</p>
          <button
            type="button"
            onClick={resetEqBands}
            disabled={disabled}
            className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Reset
          </button>
        </div>
        <div className="mt-3 grid grid-cols-10 items-end gap-1.5">
          {EQ_BAND_LABELS.map((label, index) => {
            const freqHz = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][
              index
            ];
            const value = audio.eqBands[index] ?? 0;
            return (
              <div key={label} className="flex flex-col items-center gap-1">
                <span className="text-[9px] tabular-nums text-muted-foreground/70">
                  {value > 0 ? `+${Math.round(value)}` : Math.round(value)}
                </span>
                <Slider
                  orientation="vertical"
                  min={EQ_MIN_DB}
                  max={EQ_MAX_DB}
                  step={1}
                  value={[value]}
                  disabled={disabled}
                  onValueChange={(values) => setEqBand(index, values[0] ?? 0)}
                  aria-label={`${freqHz} hertz band`}
                  className="h-24 w-4 data-[orientation=vertical]:min-h-24"
                />
                <span className="text-[9px] text-muted-foreground/70">
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The enhancer's character presets, mirroring melo's studio/vinyl/concert. */
const ENHANCER_CHIPS = [
  { id: "studio", label: "Studio", vocal: 0, air: 0, bass: 0 },
  { id: "vinyl", label: "Vinyl", vocal: 15, air: -15, bass: 25 },
  { id: "concert", label: "Concert", vocal: -10, air: 30, bass: 15 },
] as const;

function EnhancerSection({ disabled }: { disabled: boolean }) {
  const audio = useAudioSettingsStore((s) => s.audio);
  const setEnhancerEnabled = useAudioSettingsStore((s) => s.setEnhancerEnabled);
  const setEnhancerEngine = useAudioSettingsStore((s) => s.setEnhancerEngine);
  const setEnhancerParam = useAudioSettingsStore((s) => s.setEnhancerParam);
  const setEnhancerPreset = useAudioSettingsStore((s) => s.setEnhancerPreset);
  const setNormalize = useAudioSettingsStore((s) => s.setNormalize);

  const knobsDisabled = disabled || !audio.enhancerEnabled;
  const activePreset = ENHANCER_CHIPS.find(
    (p) =>
      audio.enhancerVocal === p.vocal &&
      audio.enhancerAir === p.air &&
      audio.enhancerBass === p.bass,
  )?.id;

  return (
    <div className="space-y-2">
      <PanelToggle
        label="High Quality"
        description="Compressor, tone shaping and harmonic saturation"
        on={audio.enhancerEnabled}
        onToggle={() => setEnhancerEnabled(!audio.enhancerEnabled)}
        disabled={disabled}
      />

      <div
        className={cn(
          "space-y-2 transition-opacity",
          knobsDisabled && "pointer-events-none opacity-50",
        )}
      >
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
          <p className="text-sm font-medium">Enhancement engine</p>
          <select
            value={audio.enhancerEngine}
            onChange={(e) =>
              setEnhancerEngine(e.target.value as "harmonic" | "air" | "depth")
            }
            aria-label="Enhancement engine"
            className="mt-2 w-full rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-medium text-foreground outline-none"
          >
            <option value="harmonic">Harmonic — warmth and presence</option>
            <option value="air">Air — high-end detail and space</option>
            <option value="depth">Depth — low-end weight and control</option>
          </select>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ENHANCER_CHIPS.map((p) => (
              <PanelChip
                key={p.id}
                label={p.label}
                active={activePreset === p.id}
                onClick={() => setEnhancerPreset(p.id)}
              />
            ))}
          </div>
        </div>

        <PanelSlider
          label="Vocal Clarity"
          value={audio.enhancerVocal}
          min={ENHANCER_MIN}
          max={ENHANCER_MAX}
          step={1}
          format={formatPercent}
          onChange={(v) => setEnhancerParam("vocal", v)}
        />
        <PanelSlider
          label="High-End Air"
          value={audio.enhancerAir}
          min={ENHANCER_MIN}
          max={ENHANCER_MAX}
          step={1}
          format={formatPercent}
          onChange={(v) => setEnhancerParam("air", v)}
        />
        <PanelSlider
          label="Bass Depth"
          value={audio.enhancerBass}
          min={ENHANCER_MIN}
          max={ENHANCER_MAX}
          step={1}
          format={formatPercent}
          onChange={(v) => setEnhancerParam("bass", v)}
        />
      </div>

      <PanelToggle
        label="Normalize volume"
        description="Keeps loudness similar between tracks (up to ±4 dB, adjusts live)"
        on={audio.normalize}
        onToggle={() => setNormalize(!audio.normalize)}
        disabled={disabled}
      />
    </div>
  );
}

function SleepSection() {
  const sleepEndsAt = usePlayerStore((s) => s.sleepEndsAt);
  const sleepAtSongEnd = usePlayerStore((s) => s.sleepAtSongEnd);
  const sleepAtQueueEnd = usePlayerStore((s) => s.sleepAtQueueEnd);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const now = useSleepCountdown(sleepEndsAt);

  const armed = sleepEndsAt !== null || sleepAtSongEnd || sleepAtQueueEnd;
  const status = !armed
    ? "Off"
    : sleepEndsAt !== null
      ? formatRemaining(sleepEndsAt - now)
      : sleepAtSongEnd
        ? "End of track"
        : "End of queue";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Sleep timer</span>
        <span
          className={cn(
            "text-xs tabular-nums",
            armed
              ? "text-[rgb(var(--tint))]"
              : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[15, 30, 45, 60].map((m) => {
          // A preset is lit while the remaining time is inside its bucket —
          // compared against the ticking clock, so a countdown that runs
          // into the next bucket updates the highlight.
          const active =
            sleepEndsAt !== null && sleepEndsAt - now > (m - 1) * 60_000 &&
            sleepEndsAt - now <= m * 60_000;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setSleepTimer(m)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                active
                  ? "border-transparent bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
                  : "border-white/10 text-muted-foreground hover:border-white/30 hover:text-foreground",
              )}
            >
              {m} min
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSleepTimer("end")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
            sleepAtSongEnd
              ? "border-transparent bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
              : "border-white/10 text-muted-foreground hover:border-white/30 hover:text-foreground",
          )}
        >
          End of track
        </button>
        <button
          type="button"
          onClick={() => setSleepTimer("queue")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
            sleepAtQueueEnd
              ? "border-transparent bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
              : "border-white/10 text-muted-foreground hover:border-white/30 hover:text-foreground",
          )}
        >
          End of queue
        </button>
        <button
          type="button"
          onClick={() => setSleepTimer(null)}
          className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-white/30 hover:text-foreground"
        >
          Turn off
        </button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Fades nothing in, breaks nothing: when the timer runs out, playback
        stops — both audio decks and the YouTube engine.
      </p>
    </div>
  );
}

export function AudioSettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [section, setSection] = useState<SectionId>("speed");
  const modified = useAudioSettingsStore((s) => s.modified);
  const resetAll = useAudioSettingsStore((s) => s.resetAll);
  const setRate = usePlayerStore((s) => s.setRate);
  // Read during render, not in an effect: the graph-failure flag is sticky
  // for the session, so sampling it while open is an honest snapshot — and
  // it re-samples every time the panel reopens for free.
  const graphFailed = open ? audioGraphFailed() : false;

  useEffect(() => {
    if (!open) return;
    // Show what the engine actually holds, closing any drift a non-store
    // surface might have introduced since the last open.
    syncFromEngine();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Transparent click-away layer — the panel itself sits above it, so an
          outside click closes it like melo's connected card does. */}
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
        data-testid="audio-settings-overlay"
      />
      <div
        role="dialog"
        aria-label="Audio settings"
        data-testid="audio-settings-panel"
        className="fixed bottom-24 left-4 right-4 z-50 flex max-h-[min(72vh,560px)] flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-black/75 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:left-auto sm:w-[min(92vw,620px)] lg:bottom-28"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3.5 pb-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Audio</h2>
            {modified && (
              <span
                className="size-1.5 rounded-full bg-[rgb(var(--tint))]"
                aria-label="Audio settings modified"
              />
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close audio settings"
            className="rounded-full border border-white/10 p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {graphFailed && (
          <p className="mx-4 mb-2 rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            Web Audio couldn&apos;t start on this device, so processing
            controls are unavailable — playback still works.
          </p>
        )}

        {/* body: rail + section */}
        <div className="flex min-h-0 flex-1 gap-1 px-2 pb-2">
          <nav
            aria-label="Audio sections"
            className="flex shrink-0 flex-col gap-1 py-1 pr-1"
          >
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                aria-pressed={section === id}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors",
                  section === id
                    ? "bg-white text-black"
                    : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2">
            {section === "enhancer" && <EnhancerSection disabled={graphFailed} />}
            {section === "speed" && <SpeedPitchSection disabled={graphFailed} />}
            {section === "fx" && <FxSection disabled={graphFailed} />}
            {section === "eq" && <EqualizerSection disabled={graphFailed} />}
            {section === "sleep" && <SleepSection />}
          </div>
        </div>

        {/* footer */}
        <div className="shrink-0 border-t border-white/[0.07] px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              resetAll();
              // The rate lives in the player store too — reset it there so
              // the HUD, ss.rate and the decks all land back at 1.0.
              setRate(1);
              toast.success("Audio settings reset");
            }}
            className="w-full rounded-full border border-white/12 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-white/30 hover:text-foreground"
          >
            Reset audio settings
          </button>
        </div>
      </div>
    </>
  );
}
