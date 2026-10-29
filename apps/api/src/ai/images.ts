/**
 * Image inputs for vision calls. Only our own Cloudinary URLs are accepted (assertCloudinaryUrl, prevents SSRF);
 * we download the bytes server-side (no redirects followed) and hand them to the model.
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

async function fetchCloudinary(url: string): Promise<ImageInput> {
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
  return (override ?? fetchCloudinary)(resizedCloudinaryUrl(url));
}
