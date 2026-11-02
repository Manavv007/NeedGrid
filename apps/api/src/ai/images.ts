/**
 * Image inputs for vision calls. Uploaded photos must be our own Cloudinary URLs (assertCloudinaryUrl, prevents SSRF);
 * product reference images only come from Channel3's image host. We download the bytes server-side (no redirects
 * followed) and hand them to the model.
 */
import { assertCloudinaryUrl, HttpError } from "../lib/http";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
/** Resized JPEG delivery keeps tokens (and latency) down. */
const RESIZE = "w_1600,c_limit,q_auto,f_jpg";

export interface ImageInput {
  bytes: Uint8Array;
  mediaType: string;
}

/** `…/image/upload/v123/x.png` → `…/image/upload/w_1600,c_limit,q_auto,f_jpg/v123/x.png`. Idempotent. */
export function resizedCloudinaryUrl(url: string): string {
  const u = new URL(url);
  const marker = "/upload/";
  const i = u.pathname.indexOf(marker);
  if (i === -1) return url;
  const after = u.pathname.slice(i + marker.length);
  if (after.startsWith(`${RESIZE}/`)) return url;
  u.pathname = `${u.pathname.slice(0, i + marker.length)}${RESIZE}/${after}`;
  return u.toString();
}

export type ImageFetcher = (url: string) => Promise<ImageInput>;

async function fetchImage(url: string): Promise<ImageInput> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    console.error("[ai] image download failed", { message: (err as Error).message });
    throw new HttpError(502, "UPSTREAM", "Couldn't download the image, try again");
  }
  if (!res.ok) throw new HttpError(400, "VALIDATION", "Couldn't open that image. Upload it again.");
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!type.startsWith("image/")) throw new HttpError(400, "VALIDATION", "That file isn't an image");
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new HttpError(400, "VALIDATION", "The image is too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(400, "VALIDATION", "The image is too large");
  return { bytes, mediaType: type };
}

let override: ImageFetcher | null = null;

/** Tests: replace the downloader (null restores the real one). */
export function setImageFetcher(f: ImageFetcher | null): void {
  override = f;
}

/** Validates the host, requests a resized JPEG, downloads it. Throws HttpError 400/502. */
export async function loadImage(url: string): Promise<ImageInput> {
  assertCloudinaryUrl(url);
  return (override ?? fetchImage)(resizedCloudinaryUrl(url));
}

/** Channel3 serves every product image from this host (all 1313 in the seed cache, Nov 1). */
export const PRODUCT_IMAGE_HOSTS = new Set(["cdn.trychannel3.com"]);

/**
 * A product's reference image (delivery check), or null if it isn't on an allowed host or can't be downloaded.
 * Only exact allowed https hosts, no redirects (prevents SSRF through a product's imageUrl). Never throws.
 */
export async function loadProductImage(url: string | null): Promise<ImageInput | null> {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !PRODUCT_IMAGE_HOSTS.has(u.hostname) || u.port || u.username || u.password) {
    return null;
  }
  try {
    return await (override ?? fetchImage)(u.toString());
  } catch {
    return null;
  }
}
