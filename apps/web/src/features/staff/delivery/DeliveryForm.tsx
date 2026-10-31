import type { NeedCard } from "@needgrid/shared";
import { CameraOff, CircleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { photoUploadAvailable } from "@/lib/cloudinary";
import { formatDonorCount } from "@/lib/format";
import { StepCard } from "../manage/StepCard";
import { ArrivalPhotoField } from "./ArrivalPhotoField";
import { MAX_NOTE_LENGTH } from "./delivery";
import { NoteField } from "./NoteField";
import type { PhotoUploadControls } from "./usePhotoUpload";

type DeliveryFormProps = {
  need: NeedCard;
  photo: PhotoUploadControls;
  note: string;
  onNoteChange: (note: string) => void;
  /** Why the last check failed (the server's words for a refusal). */
  problem: string | null;
  onCheck: (photoUrl: string) => void;
  /** Focus the photo input (back here after "Retake photo"). */
  focusPhoto: boolean;
};

/** Step 1: the arrival photo and an optional note, then "Check delivery". */
export function DeliveryForm({ need, photo, note, onNoteChange, problem, onCheck, focusPhoto }: DeliveryFormProps) {
  const [submitted, setSubmitted] = useState(false);
  const { upload } = photo;
  // Without Cloudinary (and with mocks off) there's no way to get a photo URL the API accepts.
  const canUpload = photoUploadAvailable();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (upload.kind !== "ready" || note.length > MAX_NOTE_LENGTH) return;
    onCheck(upload.url);
  }

  return (
    <StepCard
      title="Record the delivery"
      note={need.donorCount > 0 ? `${formatDonorCount(need.donorCount)} waiting for a photo` : null}
    >
      <form noValidate onSubmit={submit} className="flex flex-wrap gap-7 p-4 sm:p-5.5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
          <p className="max-w-150 text-[15px] leading-normal text-soft">
            When {need.title} arrives, add a photo. NeedGrid checks it against the product, then donors see it on their
            impact page.
          </p>
          {canUpload ? (
            <ArrivalPhotoField photo={photo} missing={submitted && upload.kind !== "ready"} focus={focusPhoto} />
          ) : (
            <p className="flex gap-2.5 rounded-xl border-2 border-dashed border-border-strong p-4 text-sm text-soft">
              <CameraOff aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" />
              Photo upload isn&apos;t set up on this site yet, so a delivery can&apos;t be recorded here.
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          <NoteField
            label="Note for donors (optional)"
            value={note}
            onChange={onNoteChange}
            help="We'll turn this into a short thank-you for donors."
            placeholder="e.g. On the shelf by lunch. 30 families covered this week."
          />
          <Button
            type="submit"
            size="lg"
            disabled={!canUpload || upload.kind === "uploading"}
            className="w-full font-extrabold"
          >
            {upload.kind === "uploading" ? "Uploading the photo…" : "Check delivery"}
          </Button>
          {problem ? (
            <p role="alert" className="flex gap-2 text-sm font-semibold text-danger">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {problem}
            </p>
          ) : null}
        </div>
      </form>
    </StepCard>
  );
}
