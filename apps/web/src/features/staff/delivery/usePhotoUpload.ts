import { useEffect, useRef, useState } from "react";
import { checkImageFile, UploadError, uploadImage } from "@/lib/cloudinary";

export type PhotoUpload =
  | { kind: "empty" }
  | { kind: "uploading"; percent: number; previewUrl: string | null }
  | { kind: "ready"; url: string; previewUrl: string | null }
  | { kind: "failed"; message: string };

const EMPTY: PhotoUpload = { kind: "empty" };
const UPLOAD_FAILED = "The photo couldn't be uploaded. Check your connection and try again.";

/** A local preview of the chosen photo (jsdom and old browsers may not have object URLs). */
function previewOf(file: File): string | null {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
}

export type PhotoUploadControls = {
  upload: PhotoUpload;
  /** Why the last picked file was refused (not a photo, too big); the previous photo stays. */
  fileProblem: string | null;
  pick: (file: File) => void;
  reset: () => void;
};

/**
 * One arrival photo: checked (an image, at most 10 MB), uploaded straight to Cloudinary with
 * progress, and previewed from the device. Picking another photo cancels an upload still running;
 * leaving the page cancels it too.
 */
export function usePhotoUpload(): PhotoUploadControls {
  const [upload, setUpload] = useState<PhotoUpload>(EMPTY);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const previewUrl = upload.kind === "uploading" || upload.kind === "ready" ? upload.previewUrl : null;
  useEffect(() => {
    if (previewUrl === null) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => () => controller.current?.abort(), []);

  async function start(file: File) {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const preview = previewOf(file);
    setUpload({ kind: "uploading", percent: 0, previewUrl: preview });
    try {
      const url = await uploadImage(file, {
        signal: ctrl.signal,
        onProgress: (percent) => {
          if (!ctrl.signal.aborted) setUpload((u) => (u.kind === "uploading" ? { ...u, percent } : u));
        },
      });
      if (!ctrl.signal.aborted) setUpload({ kind: "ready", url, previewUrl: preview });
    } catch (error) {
      if (ctrl.signal.aborted) return;
      setUpload({ kind: "failed", message: error instanceof UploadError ? error.message : UPLOAD_FAILED });
    }
  }

  function pick(file: File) {
    const problem = checkImageFile(file);
    setFileProblem(problem);
    if (problem === null) void start(file);
  }

  function reset() {
    controller.current?.abort();
    controller.current = null;
    setUpload(EMPTY);
    setFileProblem(null);
  }

  return { upload, fileProblem, pick, reset };
}
