import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";

const storeSource = readSource("src/store/player.ts");
const transportSource = readSource(
  "src/components/player/TransportControls.tsx",
);
const playerBarSource = readSource("src/components/player/PlayerBar.tsx");
const fullscreenSource = readSource(
  "src/components/player/FullscreenPlayer.tsx",
);
const shellSource = readSource("src/components/layout/AppShell.tsx");

describe("the transport shuffle button also engages smart shuffle", () => {
  test("one action owns both, and reuses the existing queue reorder", () => {
    // Smart shuffle used to be a second, separate switch living in the queue
    // panel and Settings. Pressing shuffle on the transport bar gave a plain
    // shuffle, so the mode that avoids repeats was invisible and had to be
    // hunted for.
    expect(storeSource).toMatch(/const toggleShuffleSmart = \(\) => \{/);
    // Both flags move together, in both directions.
    expect(storeSource).toMatch(
      /const turningOn = !get\(\)\.shuffle;\s*\n\s*toggleShuffle\(\);/,
    );
    expect(storeSource).toMatch(
      /localStorage\.setItem\("ss\.smartShuffle", turningOn \? "1" : "0"\);/,
    );
    expect(storeSource).toMatch(/set\(\{ smartShuffle: turningOn \}\);/);
    // The queue reorder (and the save/restore of the unshuffled order) stays
    // in one place. Re-implementing it here would let shuffle-off leave the
    // queue stuck in shuffled order.
    expect(storeSource).toMatch(
      /toggleShuffle\(\);\s*\n\s*localStorage\.setItem\("ss\.smartShuffle"/,
    );
    // Registered on the store's public surface, or the UI cannot call it.
    expect(storeSource).toMatch(/toggleShuffleSmart: \(\) => void;/);
    expect(storeSource).toMatch(/\n\s*toggleShuffleSmart,\n/);
  });

  test("both the mini player and the maximized player use it", () => {
    // There is one TransportControls component, rendered by both surfaces, so
    // the button behaviour cannot differ between them.
    expect(transportSource).toMatch(
      /const toggleShuffle = usePlayerStore\(\(s\) => s\.toggleShuffleSmart\);/,
    );
    expect(playerBarSource).toMatch(/<TransportControls/);
    expect(fullscreenSource).toMatch(/<TransportControls \/>/);
  });

  test("the engaged mode is visible, and the label is honest", () => {
    // Smart shuffle has no icon of its own, so the button is the only place it
    // can be shown. A mode that runs but cannot be seen is not a feature.
    expect(transportSource).toMatch(/shuffle && smartShuffle &&/);
    expect(transportSource).toMatch(/sr-only">Smart shuffle on/);
    expect(transportSource).toMatch(
      /label=\{shuffle \? "Shuffle on" : "Shuffle off"\}/,
    );
    // The toast has to announce the behaviour the user cannot see otherwise.
    expect(transportSource).toMatch(
      /toast\(shuffle \? "Shuffle off" : "Shuffle on — avoiding repeats"\)/,
    );
  });

  test("the S shortcut runs the same action as the button", () => {
    // Two different actions behind one button and one key is exactly how the
    // button ends up showing a mode the queue is not in.
    expect(shellSource).toMatch(/s\.toggleShuffleSmart\(\);/);
    expect(shellSource).not.toMatch(/s\.toggleShuffle\(\);/);
  });
});
