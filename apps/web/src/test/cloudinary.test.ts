import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkImageFile,
  isCloudinaryImageUrl,
  MAX_IMAGE_BYTES,
  MOCK_UPLOAD_URL,
  photoUploadAvailable,
  uploadImage,
  UploadError,
} from "@/lib/cloudinary";

// cloudinary.ts reads these at call time, so each test can switch the configuration.
const mocked = vi.hoisted(() => ({
  env: {
    VITE_API_URL: "http://api.test",
    VITE_USE_MOCKS: false,
    VITE_PAYPAL_CLIENT_ID: null,
    VITE_CLOUDINARY_CLOUD_NAME: null as string | null,
    VITE_CLOUDINARY_UPLOAD_PRESET: null as string | null,
    VITE_DEMO_STAFF_KEY: null,
  },
}));
vi.mock("@/env", () => ({ env: mocked.env }));

type Listener = (() => void) | null;

/** Stands in for XMLHttpRequest: records the request and lets the test answer it. */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = "";
  url = "";
  body: FormData | null = null;
  status = 0;
  responseText = "";
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: Listener = null;
  onerror: Listener = null;
  onabort: Listener = null;

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

function photo(size = 1024, type = "image/jpeg"): File {
  const file = new File(["x"], "shelf.jpg", { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function sentRequest(): FakeXhr {
  const xhr = FakeXhr.last;
  if (!xhr) throw new Error("No upload was started");
  return xhr;
}

beforeEach(() => {
  FakeXhr.last = null;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  mocked.env.VITE_CLOUDINARY_CLOUD_NAME = null;
  mocked.env.VITE_CLOUDINARY_UPLOAD_PRESET = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("checkImageFile", () => {
  it("accepts photos up to 10 MB", () => {
    expect(checkImageFile(photo())).toBeNull();
    expect(checkImageFile(photo(MAX_IMAGE_BYTES, "image/png"))).toBeNull();
  });

  it("refuses other file types, empty files and anything over 10 MB", () => {
    expect(checkImageFile(photo(1024, "application/pdf"))).toMatch(/isn't a photo/);
    expect(checkImageFile(photo(1024, ""))).toMatch(/isn't a photo/);
    expect(checkImageFile(photo(0))).toMatch(/empty/);
    expect(checkImageFile(photo(MAX_IMAGE_BYTES + 1))).toMatch(/bigger than 10 MB/);
  });
});

describe("isCloudinaryImageUrl", () => {
  it.each([
    ["https://res.cloudinary.com/needgrid/image/upload/v1/needgrid/a.jpg", true],
    ["http://res.cloudinary.com/needgrid/image/upload/a.jpg", false],
    ["https://res.cloudinary.com.evil.example/a.jpg", false],
    ["https://evil.example/res.cloudinary.com/a.jpg", false],
    ["https://user:pass@res.cloudinary.com/needgrid/a.jpg", false],
    ["not a url", false],
    [42, false],
  ])("%s → %s", (url, ok) => {
    expect(isCloudinaryImageUrl(url)).toBe(ok);
  });
});

describe("uploadImage", () => {
  it("checks the file before anything is sent", async () => {
    mocked.env.VITE_CLOUDINARY_CLOUD_NAME = "needgrid";
    mocked.env.VITE_CLOUDINARY_UPLOAD_PRESET = "needgrid_unsigned";
    await expect(uploadImage(photo(1024, "text/plain"))).rejects.toBeInstanceOf(UploadError);
    await expect(uploadImage(photo(MAX_IMAGE_BYTES + 1))).rejects.toThrow("bigger than 10 MB");
    expect(FakeXhr.last).toBeNull();
  });

  it("says photo upload isn't set up when Cloudinary isn't configured", async () => {
    expect(photoUploadAvailable()).toBe(false);
    await expect(uploadImage(photo())).rejects.toThrow("Photo upload isn't set up yet.");
    expect(FakeXhr.last).toBeNull();
  });

  it("posts an unsigned upload to the needgrid folder, reports progress and returns secure_url", async () => {
    mocked.env.VITE_CLOUDINARY_CLOUD_NAME = "needgrid";
    mocked.env.VITE_CLOUDINARY_UPLOAD_PRESET = "needgrid_unsigned";
    expect(photoUploadAvailable()).toBe(true);
    const progress: number[] = [];
    const file = photo();
    const result = uploadImage(file, { onProgress: (p) => progress.push(p) });

    const xhr = sentRequest();
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("https://api.cloudinary.com/v1_1/needgrid/image/upload");
    expect(xhr.body?.get("file")).toBe(file);
    expect(xhr.body?.get("upload_preset")).toBe("needgrid_unsigned");
    expect(xhr.body?.get("folder")).toBe("needgrid");
    expect([...(xhr.body?.keys() ?? [])].sort()).toEqual(["file", "folder", "upload_preset"]);

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    const url = "https://res.cloudinary.com/needgrid/image/upload/v1/needgrid/shelf.jpg";
    xhr.respond(200, { secure_url: url, url: "http://res.cloudinary.com/x.jpg" });
    await expect(result).resolves.toBe(url);
    expect(progress).toEqual([50, 100]);
  });

  it("refuses a secure_url on any other host, and failed uploads", async () => {
    mocked.env.VITE_CLOUDINARY_CLOUD_NAME = "needgrid";
    mocked.env.VITE_CLOUDINARY_UPLOAD_PRESET = "needgrid_unsigned";

    const otherHost = uploadImage(photo());
    sentRequest().respond(200, { secure_url: "https://evil.example/shelf.jpg" });
    await expect(otherHost).rejects.toBeInstanceOf(UploadError);

    const failed = uploadImage(photo());
    sentRequest().respond(400, { error: { message: "Upload preset not found" } });
    await expect(failed).rejects.toThrow("couldn't be uploaded");
  });

  it("can be cancelled", async () => {
    mocked.env.VITE_CLOUDINARY_CLOUD_NAME = "needgrid";
    mocked.env.VITE_CLOUDINARY_UPLOAD_PRESET = "needgrid_unsigned";
    const controller = new AbortController();
    const result = uploadImage(photo(), { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("in mock mode returns the fixed demo image after a short delay", async () => {
    vi.stubEnv("VITE_USE_MOCKS", "true");
    expect(photoUploadAvailable()).toBe(true);
    await expect(uploadImage(photo())).resolves.toBe(MOCK_UPLOAD_URL);
    expect(isCloudinaryImageUrl(MOCK_UPLOAD_URL)).toBe(true);
    expect(FakeXhr.last).toBeNull();
  });
});
