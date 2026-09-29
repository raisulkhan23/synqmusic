import "@vly-ai/integrations";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { ScrollToTop } from "@/components/ScrollToTop";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { MotionConfig } from "framer-motion";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import {
  applyCardTransparency,
  readCardTransparency,
} from "@/lib/cardTransparency";
import { usePlayerStore } from "@/store/player";
import "./index.css";

// SYNQ defaults to dark; restore the user's theme mode before first paint.
document.documentElement.classList.add("dark");
// Liquid glass is ON by default; restore the user's off-state before paint so
// panels never flash with the effect when it's disabled.
if (localStorage.getItem("ss.liquidGlass") === "0") {
  document.documentElement.classList.add("no-glass");
}
// Performance mode is the same idea: restore it before the first paint so a
// returning user never sees one frame of the expensive decorations.
if (localStorage.getItem("ss.performanceMode") === "1") {
  document.documentElement.classList.add("perf-lite");
}
// Restore the saved card transparency before paint so glass panels never flash
// at the default opacity first.
applyCardTransparency(readCardTransparency());
const savedTheme = localStorage.getItem("ss.themeMode");
document.documentElement.dataset.scene =
  localStorage.getItem("ss.sceneTheme") ?? "studio";
if (savedTheme === "light") {
  document.documentElement.classList.remove("dark");
  document.documentElement.classList.add("light");
} else if (savedTheme === "amoled") {
  document.documentElement.classList.add("amoled");
}

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
// A shared track link lands here and plays the song. Public, so the link works
// for someone who has never signed in — RequireAuth redirects them to /auth
// with this path preserved as `returnTo` and returns them afterwards.
const TrackLink = lazy(() => import("./pages/TrackLink.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
// AppShell (which owns PlayerBar / QueuePanel / FullscreenPlayer) is imported
// eagerly so the player UI is NEVER unmounted during lazy page-chunk loads.
import AppShell from "./components/layout/AppShell.tsx";
const Home = lazy(() => import("./pages/Home.tsx"));
const Search = lazy(() => import("./pages/Search.tsx"));
const Artist = lazy(() => import("./pages/Artist.tsx"));
const Album = lazy(() => import("./pages/Album.tsx"));
const Liked = lazy(() => import("./pages/Liked.tsx"));
const Playlists = lazy(() => import("./pages/Playlists.tsx"));
const PlaylistDetail = lazy(() => import("./pages/PlaylistDetail.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const Stats = lazy(() => import("./pages/Stats.tsx"));
const Recent = lazy(() => import("./pages/Recent.tsx"));
const Social = lazy(() => import("./pages/Social.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
// Public information pages linked from the landing footer. They sit OUTSIDE
// the RequireAuth group on purpose: a privacy notice or a support answer
// shouldn't require an account to read.
const Support = lazy(() => import("./pages/Support.tsx"));
const Privacy = lazy(() => import("./pages/Privacy.tsx"));
const Terms = lazy(() => import("./pages/Terms.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="flex h-full min-h-[40vh] w-full items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Page-level Suspense boundary: lazy page chunks suspend HERE instead of
 *  bubbling up and unmounting AppShell + PlayerBar during navigation. */
function PageSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteLoading />}>{children}</Suspense>;
}

/**
 * Per-ROUTE error boundary.
 *
 * Without this, a throw inside any page unwinds the whole tree: AppShell, the
 * player, the queue and the nav all unmount, and because the dev server runs
 * with the error overlay disabled the listener just gets a dead screen with no
 * message and no way out except a manual browser reload. That is why a single
 * bad artist link could make the entire app look broken.
 *
 * Scoping the boundary to the route means a failing page degrades to a card
 * with a way back, and playback, the queue and navigation keep working.
 */
class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[SYNQ] route crashed:", error);
    // A route can die while a Radix layer (menu, sheet, dialog) is open. That
    // layer owned `body { pointer-events: none }` and is now unmounted, so
    // nothing will ever clear it — the app would keep rendering while every
    // control stayed dead. Release it here, where the unmount is known.
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  }
  render() {
    if (!this.state.error) return this.props.children;
    // Remounting the subtree with a new key clears the error, so "Try again"
    // re-renders the page from scratch instead of only resetting state.
    return (
      <RouteErrorCard
        message={this.state.error.message}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}

function RouteErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-white/10 px-6 py-20 text-center">
      <p className="font-display text-lg font-semibold">
        This page didn&apos;t load
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        The rest of SYNQ is still working — your queue and playback are fine.
      </p>
      {/* The message is developer-facing and can be a long stack-ish string,
          so it is clamped rather than allowed to blow out the card. */}
      {message ? (
        <p className="max-w-md text-xs break-words text-muted-foreground/70">
          {message.length > 200 ? `${message.slice(0, 200)}…` : message}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black"
      >
        Try again
      </button>
      <Link
        to="/home"
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Back to Home
      </Link>
    </div>
  );
}

/** Suspense + error boundary for one route, as a single wrapper. */
function PageBoundary({ children }: { children: React.ReactNode }) {
  return (
    <RouteErrorBoundary>
      <PageSuspense>{children}</PageSuspense>
    </RouteErrorBoundary>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/**
 * Force a fresh copy of the app exactly once per session, on first load.
 *
 * The dev server here has been dropping and restarting, and a tab that was
 * open across one of those restarts keeps running the module graph it already
 * has. That graph is the thing that decides which routes exist, so a route
 * added after the tab opened is simply absent from it: the artist link looks
 * dead, and only a manual hard refresh — which pulls the current graph — makes
 * it work. Nothing in the app was wrong; the tab was.
 *
 * `no-store` on the reload bypasses the HTTP cache, and a sessionStorage flag
 * makes it happen once, so this cannot become a reload loop. `location.replace`
 * keeps the current URL, so the listener stays on whatever they were looking
 * at. If the reload is blocked it fails silently and the app loads as normal.
 */
function FreshBundleOnBoot() {
  useEffect(() => {
    const KEY = "synq:fresh-boot";
    try {
      if (sessionStorage.getItem(KEY) === "1") return;
      sessionStorage.setItem(KEY, "1");
    } catch {
      return; // storage blocked — never risk a reload loop
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("_cb", String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      /* ignore — the app still works, it is just not cache-busted */
    }
  }, []);
  return null;
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-background text-foreground p-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {/* A boundary that only renders the error is a dead end: the app
                unmounted, so every in-app control is gone and the only escape
                was a manual browser reload. Offering the reload here, and
                re-mounting the tree when it is pressed, means one click gets
                the listener back instead of a keyboard shortcut they have to
                know about. */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black"
            >
              Reload SYNQ
            </button>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

/** Keeps \`html.perf-lite\` in sync with the store.
 *
 *  This lives at the app root rather than in AppShell because most of the
 *  expensive surfaces are on the public pages: the landing hero, the auth card
 *  and the support pages all render outside the signed-in shell, and a class
 *  only AppShell ever sets leaves every one of them running at full cost. */
function PerformanceModeSync() {
  const performanceMode = usePlayerStore((s) => s.performanceMode);
  useEffect(() => {
    document.documentElement.classList.toggle("perf-lite", performanceMode);
  }, [performanceMode]);
  return null;
}

/** Performance mode also has to reach the animations CSS cannot see.
 *
 *  framer-motion drives its animations from JavaScript, so `animation: none`
 *  does nothing to them — the hero, the queue panel and the sidebar would keep
 *  animating with every effect switched off. `reducedMotion: "always"` is the
 *  supported way to tell the library to stop moving things. */
function MotionPrefs({ children }: { children: React.ReactNode }) {
  const performanceMode = usePlayerStore((s) => s.performanceMode);
  return (
    <MotionConfig reducedMotion={performanceMode ? "always" : "never"}>
      {children}
    </MotionConfig>
  );
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <FreshBundleOnBoot />
          <RouteSyncer />
          <PerformanceModeSync />
          <ScrollToTop />
          <MotionPrefs>
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route
                  path="/auth"
                  element={<AuthPage redirectAfterAuth="/home" />}
                />
                <Route path="/t/:trackId" element={<TrackLink />} />
                <Route
                  path="/dashboard"
                  element={
                    <RequireAuth>
                      <Navigate to="/home" replace />
                    </RequireAuth>
                  }
                />
                <Route
                  element={
                    <RequireAuth>
                      <AppShell />
                    </RequireAuth>
                  }
                >
                  <Route
                    path="/home"
                    element={
                      <PageBoundary>
                        <Home />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/search"
                    element={
                      <PageBoundary>
                        <Search />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/artist/:artist"
                    element={
                      <PageBoundary>
                        <Artist />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/album/:artist/:album"
                    element={
                      <PageBoundary>
                        <Album />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/liked"
                    element={
                      <PageBoundary>
                        <Liked />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/playlists"
                    element={
                      <PageBoundary>
                        <Playlists />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/playlist/:id"
                    element={
                      <PageBoundary>
                        <PlaylistDetail />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/stats"
                    element={
                      <PageBoundary>
                        <Stats />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/recent"
                    element={
                      <PageBoundary>
                        <Recent />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/social"
                    element={
                      <PageBoundary>
                        <Social />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/profile"
                    element={
                      <PageBoundary>
                        <Profile />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <PageBoundary>
                        <Settings />
                      </PageBoundary>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <PageBoundary>
                        <Admin />
                      </PageBoundary>
                    }
                  />
                </Route>
                <Route path="/support" element={<Support />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </MotionPrefs>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
