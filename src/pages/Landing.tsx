import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router";
import { Logo } from "@/components/brand/Logo";
import {
  Activity,
  Disc3,
  Headphones,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Zap,
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: "easeOut" as const },
};

const VIS_BARS = 48;

/**
 * Animated visualizer demo for the landing page — a dancing bar spectrum
 * rendered with requestAnimationFrame. Purely decorative (no audio source
 * on the landing page), it mirrors the live visualizer in the app player.
 */
function VisualizerDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const values = new Float32Array(VIS_BARS);
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const gap = Math.min(5, w / (VIS_BARS * 2));
      const bw = Math.max(2, (w - (VIS_BARS - 1) * gap) / VIS_BARS - gap);
      const maxBarH = h * 0.78;
      const baseline = h * 0.92;

      for (let i = 0; i < VIS_BARS; i++) {
        // Layered sines give an organic, music-like motion per bar.
        const target =
          0.14 +
          0.6 * Math.abs(Math.sin(now / 820 + i * 0.55)) * (0.5 + 0.5 * Math.sin(now / 340 + i * 1.15));
        values[i] += (target - values[i]) * Math.min(1, dt * 8);
        const bh = Math.max(3, values[i] * maxBarH);
        const x = (w - (VIS_BARS * bw + (VIS_BARS - 1) * gap)) / 2 + i * (bw + gap);
        const grad = ctx.createLinearGradient(0, baseline - bh, 0, baseline);
        grad.addColorStop(0, "rgba(203,244,143,0.85)");
        grad.addColorStop(1, "rgba(139,92,246,0.35)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, baseline - bh, bw, bh, bw / 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c11]/70 px-6 py-12">
      <p className="flex items-center justify-center gap-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        <Activity className="size-4" />
        Live audio visualizer
      </p>
      <canvas ref={canvasRef} className="mt-8 h-56 w-full sm:h-72" />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Every track comes alive with a real-time frequency spectrum in the
        full-screen player.
      </p>
    </div>
  );
}

const EXPERIENCE_TRACKS = [
  { title: "Show Me Love", artist: "Robin S", tone: "from-brand/80 via-lime-300/35 to-transparent", rotate: "-12" },
  { title: "Khusir Anek Range", artist: "Rp Creation", tone: "from-violet-500/75 via-fuchsia-400/25 to-transparent", rotate: "10" },
  { title: "Mahe Mahe Tobo", artist: "Nure Al Miskat", tone: "from-cyan-400/70 via-blue-500/25 to-transparent", rotate: "-7" },
];

function ListeningExperience() {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a0b10]/80 px-4 py-8 shadow-[0_30px_100px_rgba(0,0,0,0.42)] sm:px-8 sm:py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_70%_at_50%_45%,rgba(203,244,143,0.10),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,transparent,black_28%,black_72%,transparent)]" />
      <div className="relative mx-auto max-w-5xl">
        <div className="mx-auto max-w-xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/8 px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-brand uppercase">
            <Sparkles className="size-3.5" /> One continuous atmosphere
          </span>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-5xl">
            Your queue, in motion.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            From the first note to the next obsession, every layer of SYNQ is designed to keep you in the flow.
          </p>
        </div>

        <div className="relative mx-auto mt-10 h-[360px] max-w-4xl sm:mt-14 sm:h-[430px]">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
            className="absolute left-1/2 top-1/2 size-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-brand/20 sm:size-[330px]"
          >
            <span className="absolute left-1/2 top-[-5px] size-2.5 -translate-x-1/2 rounded-full bg-brand shadow-[0_0_18px_5px_rgba(203,244,143,0.45)]" />
            <span className="absolute bottom-[12%] right-[-4px] size-2 rounded-full bg-violet-300 shadow-[0_0_16px_4px_rgba(196,181,253,0.4)]" />
          </motion.div>
          <div className="absolute left-1/2 top-1/2 size-[205px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/[0.025] shadow-[0_0_80px_rgba(203,244,143,0.08)] sm:size-[270px]" />
          <div className="absolute left-1/2 top-1/2 size-[150px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand/20 bg-brand/5 sm:size-[200px]" />

          <motion.div
            animate={{ y: [0, -8, 0], rotate: [0, 2, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="absolute left-1/2 top-1/2 z-10 size-[122px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-[#11151a] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.55),0_0_45px_rgba(203,244,143,0.16)] sm:size-[164px]"
          >
            <div className="relative size-full overflow-hidden rounded-full border border-white/10">
              <img src="/show-me-love-cover.svg" alt="" className="size-full object-cover" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_30%,rgba(0,0,0,0.45))]" />
              <div className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 bg-[#11151a] shadow-[0_0_0_5px_rgba(255,255,255,0.06)] sm:size-9" />
            </div>
          </motion.div>

          {EXPERIENCE_TRACKS.map((track, index) => (
            <motion.div
              key={track.title}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.12, duration: 0.5 }}
              animate={{ y: [0, index % 2 === 0 ? -7 : 7, 0] }}
              style={{ rotate: track.rotate }}
              className={`liquid-glass absolute z-20 w-[190px] rounded-2xl border border-white/10 p-3 shadow-[0_18px_45px_rgba(0,0,0,0.4)] sm:w-[220px] ${
                index === 0
                  ? "left-[3%] top-[12%] sm:left-[7%] sm:top-[10%]"
                  : index === 1
                    ? "right-[2%] top-[17%] sm:right-[6%] sm:top-[13%]"
                    : "bottom-[4%] left-[9%] sm:bottom-[5%] sm:left-[16%]"
              }`}
            >
              <div className={`h-1.5 rounded-full bg-gradient-to-r ${track.tone}`} />
              <div className="mt-3 flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-white/[0.07] text-brand">
                  <Disc3 className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{track.artist}</p>
                </div>
                <Headphones className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-3 flex h-5 items-end gap-1">
                {Array.from({ length: 18 }, (_, i) => (
                  <span
                    key={i}
                    className="eq-bar w-1 rounded-full bg-brand/70"
                    style={{ height: `${25 + ((i * 29) % 70)}%`, animationDelay: `${(i % 6) * 0.11}s` }}
                  />
                ))}
              </div>
            </motion.div>
          ))}

          <div className="absolute bottom-[7%] right-[8%] z-20 hidden items-center gap-2 rounded-full border border-white/10 bg-[#11131a]/85 px-3 py-2 text-[10px] font-medium text-muted-foreground shadow-xl backdrop-blur-xl sm:flex">
            <span className="size-1.5 animate-pulse rounded-full bg-brand" />
            Queue synced · 3 tracks
          </div>
        </div>

        <div className="relative mx-auto grid max-w-3xl grid-cols-3 gap-2 border-t border-white/[0.07] pt-5 text-center sm:gap-4">
          {[
            ["∞", "endless discovery"],
            ["0", "interruptions"],
            ["1", "continuous mix"],
          ].map(([value, label]) => (
            <div key={label}>
              <p className="font-display text-xl font-bold text-brand sm:text-2xl">{value}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground sm:text-xs">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Landing() {

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px]">
        <div className="absolute left-1/2 top-[-220px] h-[560px] w-[860px] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" />
        <div className="absolute top-[280px] right-[-140px] h-[360px] w-[360px] rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute top-[380px] left-[-160px] h-[320px] w-[320px] rounded-full bg-teal-500/10 blur-3xl" />
      </div>

      {/* nav */}
      <header className="relative z-20 mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo to="/" />
        <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
          <a href="#features" className="transition-colors hover:text-foreground">
            Features
          </a>
          <a href="#visualizer" className="transition-colors hover:text-foreground">
            Visualizer
          </a>
          <a href="#experience" className="transition-colors hover:text-foreground">
            Experience
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Sign in
          </Link>
          <Link
            to="/auth?returnTo=/home"
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground shadow-[0_6px_24px_rgb(203_244_143/0.35)] transition-transform hover:scale-105"
          >
            Start listening
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-14 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:pt-16 lg:pb-28">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-muted-foreground"
          >
            <span className="size-1.5 rounded-full bg-brand" />
            SYNQ · ad-free · 320 kbps
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="mt-6 font-display text-4xl leading-[1.06] font-bold tracking-tight sm:text-6xl"
          >
            Your music,
            <br />
            <span className="text-brand">uninterrupted.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.16 }}
            className="mt-5 max-w-md text-base leading-7 text-muted-foreground sm:text-lg"
          >
            SYNQ streams a carefully curated catalog in crisp 320 kbps — with
            a live visualizer, a queue you can rearrange, and absolutely no ads.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.24 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Link
              to="/auth?returnTo=/home"
              className="flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground shadow-[0_10px_36px_rgb(203_244_143/0.4)] transition-transform hover:scale-105"
            >
              <Play className="size-4 fill-current" />
              Start listening free
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-muted-foreground"
          >
            {[
              ["0", "ads"],
              ["320k", "bitrate"],
            ].map(([n, label]) => (
              <div key={label}>
                <p className="font-display text-xl font-bold text-foreground">{n}</p>
                <p className="text-xs">{label}</p>
              </div>
            ))}
          </motion.div>
        </div>

        {/* player mockup */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative mx-auto w-full max-w-md"
        >
          <div className="liquid-glass relative rounded-3xl border border-white/10 p-6 shadow-[0_40px_90px_rgba(0,0,0,0.55)]">
            {/* now playing */}
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <img
                  src="/show-me-love-cover.svg"
                  alt="Now playing cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                  className="spin-slow size-16 rounded-full object-cover ring-4 ring-white/10"
                />
                <span className="absolute inset-0 rounded-full ring-1 ring-black/20" />
              </div>
              <div className="min-w-0">
                <p className="font-display text-[15px] font-bold tracking-tight">
                  Show Me Love
                </p>
                <p className="text-xs text-muted-foreground">Robin S</p>
              </div>
              <Heart className="ml-auto size-4 shrink-0 fill-brand text-brand" />
            </div>

            {/* seek */}
            <div className="mt-5 flex items-center gap-2">
              <span className="text-[10px] tabular-nums text-muted-foreground">1:24</span>
              <div className="relative h-1 flex-1 rounded-full bg-white/10">
                <div className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-brand" />
                <div className="absolute top-1/2 left-[38%] size-2.5 -translate-y-1/2 rounded-full bg-white shadow" />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">3:32</span>
            </div>

            {/* transport */}
            <div className="mt-4 flex items-center justify-center gap-4 text-muted-foreground">
              <Shuffle className="size-4 text-brand" />
              <SkipBack className="size-4 fill-current" />
              <span className="flex size-10 items-center justify-center rounded-full bg-white text-black shadow-lg">
                <Pause className="size-4 fill-current" />
              </span>
              <SkipForward className="size-4 fill-current" />
              <Repeat className="size-4" />
            </div>

            {/* visualizer strip */}
            <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4">
              <div className="flex h-5 items-end gap-[3px]">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span
                    key={i}
                    className="eq-bar w-[3px] rounded-full bg-brand"
                    style={{
                      height: `${20 + ((i * 37) % 80)}%`,
                      animationDelay: `${(i % 7) * 0.12}s`,
                      animationDuration: `${0.8 + (i % 5) * 0.18}s`,
                    }}
                  />
                ))}
              </div>
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Activity className="size-3.5 text-brand" />
                Live spectrum
              </span>
            </div>
          </div>

          {/* floating chips */}
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -top-5 -right-3 hidden rounded-2xl border border-white/10 bg-[#12141b]/90 px-4 py-3 shadow-xl backdrop-blur-xl sm:block"
          >
            <p className="text-[11px] font-semibold text-muted-foreground uppercase">
              Full-screen mode
            </p>
            <div className="mt-1.5 flex h-4 items-end gap-[3px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="eq-bar w-[3px] rounded-full bg-violet-400"
                  style={{
                    height: `${40 + i * 14}%`,
                    animationDelay: `${i * 0.16}s`,
                  }}
                />
              ))}
            </div>
          </motion.div>

          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="absolute -bottom-5 -left-3 hidden rounded-2xl border border-white/10 bg-[#12141b]/90 px-4 py-3 shadow-xl backdrop-blur-xl sm:block"
          >
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-brand" />
              Zero ads. Ever.
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              No banners, no promos, no interruptions.
            </p>
          </motion.div>
        </motion.div>
      </section>

      {/* visual story — the listening atmosphere */}
      <section id="experience" className="relative z-10 mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <ListeningExperience />
      </section>

      {/* features */}
      <section id="features" className="relative z-10 mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            A player that feels alive
          </h2>
          <p className="mt-3 text-muted-foreground">
            Every detail is tuned for one thing: the music. No clutter, no noise.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: ShieldCheck,
              title: "Zero ads, always",
              body: "No banners, no promotions, no interruptions. The interface is all music.",
            },
            {
              icon: Zap,
              title: "Instant playback",
              body: "Optimistic controls and a persistent player that never stops while you browse.",
            },
            {
              icon: Activity,
              title: "Live visualizer",
              body: "A canvas frequency spectrum that dances with the audio in full-screen mode.",
            },
            {
              icon: ListMusic,
              title: "Your library",
              body: "Like songs and build playlists with instant, optimistic updates.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <motion.div
              key={title}
              {...fadeUp}
              className="group rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 transition-colors hover:border-brand/30 hover:bg-white/[0.05]"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand/12 text-brand ring-1 ring-brand/20">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* visualizer demo — animated audio-bars driven by requestAnimationFrame */}
      <section id="visualizer" className="relative z-10 mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <VisualizerDemo />
      </section>

      {/* CTA band */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <motion.div
          {...fadeUp}
          className="relative overflow-hidden rounded-3xl border border-white/10 px-6 py-14 text-center sm:px-12"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand/18 via-transparent to-violet-500/12" />
          <div className="absolute inset-0 bg-[radial-gradient(60%_120%_at_50%_0%,rgb(203_244_143/0.12),transparent_70%)]" />
          <div className="relative">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to listen?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">
              Sign in with your email or a quick OAuth login, and the music
              starts immediately.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/auth?returnTo=/home"
                className="rounded-full bg-brand px-7 py-3 text-sm font-semibold text-brand-foreground shadow-[0_10px_36px_rgb(203_244_143/0.4)] transition-transform hover:scale-105"
              >
                Start listening
              </Link>
            </div>
          </div>
        </motion.div>
      </section>

      {/* footer */}
      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:flex-row sm:px-6">
          <Logo to="/" />
          <p className="text-xs text-muted-foreground">
            © 2026 SYNQ · Currently in beta
          </p>
          <nav className="flex items-center gap-5 text-xs font-medium text-muted-foreground">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#visualizer" className="transition-colors hover:text-foreground">
              Visualizer
            </a>
            <a href="#experience" className="transition-colors hover:text-foreground">
              Experience
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}