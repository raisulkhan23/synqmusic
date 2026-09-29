import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { readSource } from "./helpers/tailwind-css.js";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPng(rel) {
  const buf = readFileSync(rel);
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("bad PNG signature");
  let off = 8;
  let ihdr = null;
  const idat = [];
  const types = [];
  let sawEnd = false;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    types.push(type);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
      };
    }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") sawEnd = true;
    off += 12 + len;
  }
  // A truncated or mis-ordered PNG throws here rather than silently decoding.
  const raw = inflateSync(Buffer.concat(idat));
  return { ...ihdr, types, sawEnd, raw, buf };
}

const publicSvg = readFileSync("public/logo.svg", "utf8");
const assetsSvg = readFileSync("src/assets/logo.svg", "utf8");
const manifest = JSON.parse(
  readFileSync("public/manifest.webmanifest", "utf8"),
);
const indexHtml = readSource("index.html");

describe("the logo is a real, valid image everywhere it is referenced", () => {
  test("the SVG is well-formed and self-contained", () => {
    expect(publicSvg.startsWith("<svg")).toBe(true);
    expect(publicSvg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(publicSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // No external refs: an icon that 404s offline is worse than no icon.
    expect(publicSvg).not.toMatch(/href="https?:/);
    expect(publicSvg).not.toContain("<image");
  });

  test("the mark keeps a square viewBox so it never distorts", () => {
    // The wordmark sizes it with `h-7 w-auto`, so the intrinsic ratio is what
    // decides the rendered width.
    expect(publicSvg).toContain('viewBox="0 0 512 512"');
    const [w, h] = publicSvg
      .match(/width="(\d+)" height="(\d+)"/)
      .slice(1)
      .map(Number);
    expect(w).toBe(h);
  });

  test("both copies of the SVG are identical", () => {
    // `LogoDropdown` imports the asset copy while everything else uses the
    // public one. If they drift, the logo changes between screens.
    expect(assetsSvg).toBe(publicSvg);
  });

  test("the favicon and the in-app logo point at the same file", () => {
    expect(indexHtml).toContain('href="/logo.svg"');
    const logo = readSource("src/components/brand/Logo.tsx");
    expect(logo).toContain('src="/logo.svg"');
    // Every <img> of the mark must reference it, never an older asset.
    expect(logo).not.toMatch(/src="\/logo\.png"/);
  });
});

describe("the raster icons are valid PNGs, not placeholders", () => {
  test("logo.png is a real 512x512 RGBA image", () => {
    const img = readPng("public/logo.png");
    expect(img.width).toBe(512);
    expect(img.height).toBe(512);
    expect(img.depth).toBe(8);
    expect(img.color).toBe(6); // RGBA
    expect(img.types[0]).toBe("IHDR");
    expect(img.types[img.types.length - 1]).toBe("IEND");
    expect(img.sawEnd).toBe(true);
    // Scanlines are width*4 bytes plus a filter byte each.
    expect(img.raw.length).toBe(512 * (512 * 4 + 1));
  });

  test("product-icon.png is the 180x180 iOS size", () => {
    // apple-touch-icon is ignored by iOS unless it is a real PNG.
    const img = readPng("public/product-icon.png");
    expect(img.width).toBe(180);
    expect(img.height).toBe(180);
    expect(img.raw.length).toBe(180 * (180 * 4 + 1));
  });

  test("neither icon is an empty or blank file", () => {
    for (const file of ["public/logo.png", "public/product-icon.png"]) {
      const img = readPng(file);
      // Every row's filter byte is 0, and the payload is not uniform black.
      let min = 255;
      let max = 0;
      for (let y = 0; y < img.height; y++) {
        expect(img.raw[y * (img.width * 4 + 1)]).toBe(0);
        for (let i = 0; i < img.width * 4; i += 4) {
          const v = img.raw[y * (img.width * 4 + 1) + 1 + i + 3];
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      expect(min).toBe(0); // transparent corners
      expect(max).toBe(255); // painted centre
    }
  });

  test("the manifest icon matches the file that is actually shipped", () => {
    const icon = manifest.icons[0];
    expect(icon.src).toBe("/logo.png");
    expect(icon.type).toBe("image/png");
    const img = readPng(`public${icon.src}`);
    expect(img.width).toBeGreaterThanOrEqual(512);
  });
});
