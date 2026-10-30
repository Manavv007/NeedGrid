import { env } from "@/env";

/**
 * Direct, unsigned photo upload to Cloudinary (brief A7.4). The browser never holds a secret: the
 * upload preset is public and limited to our `needgrid` folder. What the API later receives is only
 * the resulting `https://res.cloudinary.com/...` URL; it rejects any other host.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const UPLOAD_FOLDER = "needgrid";
const CLOUDINARY_IMAGE_HOST = "res.cloudinary.com";

/** What mock mode "uploads" to: a fixed demo image on Cloudinary's public demo cloud. */
export const MOCK_UPLOAD_URL = `https://${CLOUDINARY_IMAGE_HOST}/demo/image/upload/needgrid/demo-shelf.jpg`;
const MOCK_UPLOAD_DELAY_MS = 600;

/** A problem with the chosen file or the upload that is safe to show to staff as it is. */
export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/** Mock mode answers uploads itself. The literal comparison lets Vite drop this path from real builds. */
function isMockMode(): boolean {
  return import.meta.env.VITE_USE_MOCKS === "true";
}

/** Photos can be uploaded in mock mode, or when both Cloudinary values are set. */
export function photoUploadAvailable(): boolean {
  return isMockMode() || (env.VITE_CLOUDINARY_CLOUD_NAME !== null && env.VITE_CLOUDINARY_UPLOAD_PRESET !== null);
}

/** Returns the reason a file can't be uploaded, or null when it is fine. */
export function checkImageFile(file: Pick<File, "type" | "size">): string | null {
  if (!file.type.startsWith("image/")) return "That file isn't a photo. Choose a picture from your camera or gallery.";
  if (file.size === 0) return "That photo is empty. Choose another one.";
  if (file.size > MAX_IMAGE_BYTES) return "That photo is bigger than 10 MB. Choose a smaller one.";
  return null;
}

/** Only our Cloudinary image host, over https, and no credentials in the URL. */
export function isCloudinaryImageUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" && url.hostname === CLOUDINARY_IMAGE_HOST && url.username === "" && url.password === ""
    );
  } catch {
    return false;
  }
}

type UploadOptions = {
  /** Whole-number percentage, 0 to 100. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
};

function abortError(): DOMException {
  return new DOMException("The upload was cancelled.", "AbortError");
}

/**
 * Uploads `file` and resolves with its `secure_url`. Rejects with `UploadError` (safe to show) for a
 * bad file, missing configuration, a failed upload or a URL on any other host, and with an
 * `AbortError` when `signal` is aborted.
 */
export async function uploadImage(file: File, options: UploadOptions = {}): Promise<string> {
  const problem = checkImageFile(file);
  if (problem) throw new UploadError(problem);
  const { signal, onProgress } = options;
  if (signal?.aborted) throw abortError();

  if (isMockMode()) {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, MOCK_UPLOAD_DELAY_MS);
      signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
          reject(abortError());
        },
        { once: true },
      );
    });
    onProgress?.(100);
    return MOCK_UPLOAD_URL;
  }

  const cloudName = env.VITE_CLOUDINARY_CLOUD_NAME;
  const preset = env.VITE_CLOUDINARY_UPLOAD_PRESET;
  if (cloudName === null || preset === null) throw new UploadError("Photo upload isn't set up yet.");

  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", preset);
  form.append("folder", UPLOAD_FOLDER);

  // XMLHttpRequest, because fetch can't report upload progress.
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const finish = () => signal?.removeEventListener("abort", onAbort);

    xhr.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      finish();
      const url = parseSecureUrl(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && url !== null) {
        onProgress?.(100);
        resolve(url);
      } else {
        reject(new UploadError("The photo couldn't be uploaded. Check your connection and try again."));
      }
    };
    xhr.onerror = () => {
      finish();
      reject(new UploadError("The photo couldn't be uploaded. Check your connection and try again."));
    };
    xhr.onabort = () => {
      finish();
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(form);
  });
}

/** The `secure_url` of a Cloudinary reply, or null unless it is an https URL on our image host. */
function parseSecureUrl(responseText: string): string | null {
  try {
    const body: unknown = JSON.parse(responseText);
    if (typeof body !== "object" || body === null || !("secure_url" in body)) return null;
    return isCloudinaryImageUrl(body.secure_url) ? body.secure_url : null;
  } catch {
    return null;
  }
}
