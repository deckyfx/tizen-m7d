import { deflateSync } from "node:zlib";

/** RGBA colour, components 0–255. */
type Rgba = readonly [number, number, number, number];

/** Icon colours: red background, white play mark. */
const BACKGROUND: Rgba = [220, 38, 38, 255];
const MARK: Rgba = [255, 255, 255, 255];

/** Icon edge in pixels (square; the TV scales it into its tiles). */
const SIZE = 512;

/** Corner radius as a share of the edge: nearly full-bleed, like the other apps' icons on this TV. */
const RADIUS = 0.06;

/** Samples per pixel edge (4×4 supersampling for smooth edges). */
const SS = 4;

/** True when (u, v), in 0–1 icon units, lies inside the rounded square. */
function inSquare(u: number, v: number): boolean {
  const cu = Math.min(Math.max(u, RADIUS), 1 - RADIUS);
  const cv = Math.min(Math.max(v, RADIUS), 1 - RADIUS);
  return (u - cu) ** 2 + (v - cv) ** 2 <= RADIUS ** 2;
}

/** True when (u, v) lies inside the play triangle (optically centred, about a third of the icon). */
function inPlay(u: number, v: number): boolean {
  const left = 0.4;
  const right = 0.68;
  if (u < left || u > right) return false;
  return Math.abs(v - 0.5) <= 0.165 * (1 - (u - left) / (right - left));
}

/** Packs RGBA rows into a PNG file. */
function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/**
 * The app icon (512×512): a red, nearly full-bleed square with a white play mark. Square only:
 * a 16:9 banner was squeezed into the square app tile on this TV.
 */
export function shimIcon(): Uint8Array {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / SIZE;
          const v = (y + (sy + 0.5) / SS) / SIZE;
          if (!inSquare(u, v)) continue;
          const color = inPlay(u, v) ? MARK : BACKGROUND;
          r += color[0];
          g += color[1];
          b += color[2];
          a += color[3];
        }
      }
      const i = (y * SIZE + x) * 4;
      // Colour averaged over covered samples only (straight alpha).
      const covered = a > 0 ? a / 255 : 1;
      rgba[i] = Math.round(r / covered);
      rgba[i + 1] = Math.round(g / covered);
      rgba[i + 2] = Math.round(b / covered);
      rgba[i + 3] = Math.round(a / (SS * SS));
    }
  }
  return encodePng(SIZE, SIZE, rgba);
}
