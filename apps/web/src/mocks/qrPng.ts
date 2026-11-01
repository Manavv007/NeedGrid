/**
 * A real, scannable QR code as a PNG data URL, for mock sponsor invoices (`qrImageDataUrl`), so mock
 * mode shows the same kind of image the API stores from PayPal's generate-qr-code. Built without a
 * canvas (jsdom has none): 1-bit greyscale PNG, scanlines in an uncompressed ("stored") zlib stream.
 */
import { create } from "qrcode";

/** Pixels per QR module, and white modules around the code. */
const SCALE = 4;
const QUIET_MODULES = 4;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The most bytes one stored deflate block can hold. */
const STORED_BLOCK_MAX = 65_535;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

const uint32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array([...Array.from(type, (c) => c.charCodeAt(0)), ...data]);
  return [...uint32(data.length), ...typed, ...uint32(crc32(typed))];
}

/** zlib wrapper around stored (uncompressed) deflate blocks: valid for any PNG decoder. */
function zlibStored(data: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  for (let start = 0; start < data.length || start === 0; start += STORED_BLOCK_MAX) {
    const block = data.subarray(start, start + STORED_BLOCK_MAX);
    const last = start + STORED_BLOCK_MAX >= data.length ? 1 : 0;
    const len = block.length;
    out.push(last, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff, ...block);
    if (last) break;
  }
  out.push(...uint32(adler32(data)));
  return new Uint8Array(out);
}

function base64(bytes: number[]): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** "data:image/png;base64,…" for a QR code that opens `value`. */
export function qrPngDataUrl(value: string): string {
  const { modules } = create(value, { errorCorrectionLevel: "M" });
  const count = modules.size;
  const size = (count + QUIET_MODULES * 2) * SCALE;
  const rowBytes = Math.ceil(size / 8);
  // One filter byte (0, none) per row, then 1 bit per pixel: 1 = white, 0 = black.
  const raw = new Uint8Array((rowBytes + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = Math.floor(y / SCALE) - QUIET_MODULES;
    for (let x = 0; x < size; x += 1) {
      const col = Math.floor(x / SCALE) - QUIET_MODULES;
      const dark = row >= 0 && row < count && col >= 0 && col < count && Boolean(modules.get(row, col));
      if (!dark) {
        const at = y * (rowBytes + 1) + 1 + (x >> 3);
        raw[at] = (raw[at] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }
  const header = new Uint8Array([...uint32(size), ...uint32(size), 1, 0, 0, 0, 0]);
  const png = [
    ...PNG_SIGNATURE,
    ...chunk("IHDR", header),
    ...chunk("IDAT", zlibStored(raw)),
    ...chunk("IEND", new Uint8Array()),
  ];
  return `data:image/png;base64,${base64(png)}`;
}
