import { Camera, Check, ImageIcon } from "lucide-react";
import { useEffect, useId, useRef, type ChangeEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PhotoUploadControls } from "./usePhotoUpload";

type ArrivalPhotoFieldProps = {
  photo: PhotoUploadControls;
  /** "Add the arrival photo first." after a Check delivery without one. */
  missing: boolean;
  /** Move keyboard focus to the photo input (after "Retake photo"). */
  focus: boolean;
};

/** Step 1's photo: the camera on phones (`capture`), any image elsewhere, with preview and progress. */
export function ArrivalPhotoField({ photo, missing, focus }: ArrivalPhotoFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, fileProblem } = photo;
  const hasPhoto = upload.kind === "uploading" || upload.kind === "ready";
  const error =
    fileProblem ?? (upload.kind === "failed" ? upload.message : missing && !hasPhoto ? MISSING_PHOTO : null);

  useEffect(() => {
    if (focus) inputRef.current?.focus();
  }, [focus]);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failed try.
    event.target.value = "";
    if (file) photo.pick(file);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {hasPhoto ? <ChosenPhoto previewUrl={upload.previewUrl} /> : null}
      {upload.kind === "uploading" ? <UploadProgress percent={upload.percent} /> : null}
      {upload.kind === "ready" ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-badge-success-text">
          <Check aria-hidden="true" className="size-4" strokeWidth={3} />
          Photo uploaded
        </p>
      ) : null}
      <label
        htmlFor={id}
        className={cn(
          "cursor-pointer has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary",
          hasPhoto
            ? cn(buttonVariants({ variant: "outline" }), "self-start")
            : "flex min-h-24 items-center gap-4 rounded-2xl border-2 border-dashed border-primary bg-surface p-5 hover:bg-primary-soft",
        )}
      >
        {hasPhoto ? (
          <>
            <Camera aria-hidden="true" />
            Choose another photo
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <Camera className="size-7" strokeWidth={2} />
            </span>
            <span className="flex flex-col gap-1">
              <strong className="text-lg">Arrival photo</strong>
              <span className="text-sm text-soft">
                Take or upload a photo of the item where it arrived. Up to 10 MB.
              </span>
            </span>
          </>
        )}
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="sr-only"
        />
      </label>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const MISSING_PHOTO = "Add the arrival photo first.";

function ChosenPhoto({ previewUrl }: { previewUrl: string | null }) {
  if (previewUrl === null) {
    return (
      <div
        aria-hidden="true"
        className="flex h-40 items-center justify-center gap-2 rounded-xl bg-placeholder-strong text-sm text-muted-foreground"
      >
        <ImageIcon className="size-6" strokeWidth={1.5} />
        Your photo
      </div>
    );
  }
  return (
    <img
      src={previewUrl}
      alt="Your upload: the item as it arrived"
      className="max-h-64 w-full rounded-xl border bg-placeholder object-contain"
    />
  );
}

function UploadProgress({ percent }: { percent: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-label="Photo upload"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% uploaded`}
        className="h-2.5 overflow-hidden rounded-full bg-track"
      >
        <div
          className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-soft">Uploading… {percent}%</p>
    </div>
  );
}
