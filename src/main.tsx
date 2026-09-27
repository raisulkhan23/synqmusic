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
                      <PageSuspense>
                        <Home />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/search"
                    element={
                      <PageSuspense>
                        <Search />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/liked"
                    element={
                      <PageSuspense>
                        <Liked />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/playlists"
                    element={
                      <PageSuspense>
                        <Playlists />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/playlist/:id"
                    element={
                      <PageSuspense>
                        <PlaylistDetail />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/stats"
                    element={
                      <PageSuspense>
                        <Stats />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/recent"
                    element={
                      <PageSuspense>
                        <Recent />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/social"
                    element={
                      <PageSuspense>
                        <Social />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/profile"
                    element={
                      <PageSuspense>
                        <Profile />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <PageSuspense>
                        <Settings />
                      </PageSuspense>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <PageSuspense>
                        <Admin />
                      </PageSuspense>
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
