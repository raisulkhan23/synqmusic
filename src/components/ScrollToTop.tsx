import { useEffect } from "react";
import { useLocation } from "react-router";

/** Scroll containers the app owns. `<main>` in the app shell carries this
 *  attribute; the public pages (landing, support, privacy, terms) scroll the
 *  document instead, so a reset has to cover both. */
const SCROLL_CONTAINERS = "[data-app-scroll]";

function afterPaint(run: () => void) {
  // Two frames: the first gives the browser a layout pass for the new route,
  // the second guarantees the new content is committed before we touch scroll
  // offsets. Resetting inside the effect alone raced the paint and left you
  // halfway down the new page.
  requestAnimationFrame(() => requestAnimationFrame(run));
}

/** Puts the viewport at the top of whatever route you navigate to.
 *
 *  Clicking a footer link while parked at the bottom of a long page used to
 *  drop you into the new page at the same offset (or no offset at all),
 *  because the browser only restores/keeps the *document* scroll and the app
 *  shell scrolls `<main>`. Resolving it in one place covers every `<Link>`,
 *  including the ones in the shared footer, instead of patching each one. */
export function ScrollToTop() {
  const { pathname, search, hash, key } = useLocation();

  useEffect(() => {
    let cancelled = false;

    const resetToTop = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo({ top: 0, left: 0 });
      }
      document
        .querySelectorAll<HTMLElement>(SCROLL_CONTAINERS)
        .forEach((element) => {
          if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
            element.scrollTo({ top: 0, left: 0 });
          }
        });
    };

    const scrollToAnchor = () => {
      if (!hash) return false;
      const id = decodeURIComponent(hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return false;
      // `scrollIntoView` also walks up the scrollable ancestors, so it lands
      // correctly whether the section lives in the document or inside the
      // shell's `<main>`.
      target.scrollIntoView({ block: "start" });
      return true;
    };

    // Immediate reset so there is no frame of the old offset on screen. An
    // anchor navigation is skipped here — jumping to the top for two frames
    // before sliding to `#features` reads as a glitch.
    if (!hash) resetToTop();

    // Then again once the new route has painted, because the first pass can
    // run while the previous page is still the one on screen.
    afterPaint(() => {
      if (cancelled) return;
      if (!scrollToAnchor()) resetToTop();
    });

    return () => {
      cancelled = true;
    };
    // `key` is in the list on purpose: re-clicking the link you are already on
    // (or going back to it) produces the same pathname/search/hash, and
    // without `key` the reset would be skipped.
  }, [pathname, search, hash, key]);

  return null;
}
