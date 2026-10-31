import type { DeliveryView, NeedCard } from "@needgrid/shared";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useDelivery } from "@/lib/queries";
import { deliveryErrorMessage, deliveryToReview } from "./delivery";
import { DeliveryChecking } from "./DeliveryChecking";
import { DeliveryForm } from "./DeliveryForm";
import { DeliveryReview } from "./DeliveryReview";
import { usePhotoUpload, type PhotoUploadControls } from "./usePhotoUpload";

type DeliveryPanelProps = {
  /** An `ordered` need. */
  need: NeedCard;
  /** `StaffNeedDetailRes.delivery`: the latest delivery recorded for it, if any. */
  delivery: DeliveryView | null;
};

/**
 * Recording a delivery (brief §9.9, Delivery.dc.html): photo and note → the server's photo check →
 * the need is delivered at once, or staff review it first. A delivery still waiting for review
 * (after a reload too) opens the review step; "Retake photo" goes back to step 1 keeping the note.
 * The server decides the score and the outcome; this panel only shows what it sent.
 */
export function DeliveryPanel({ need, delivery }: DeliveryPanelProps) {
  const record = useDelivery();
  const upload = usePhotoUpload();
  const busy = useRef(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  /** The review staff chose to retake: step 1 shows instead until a new check replaces it. */
  const [retaking, setRetaking] = useState<string | null>(null);
  const [focus, setFocus] = useState<"review" | "photo" | null>(null);

  const review = deliveryToReview(delivery);

  const photo: PhotoUploadControls = {
    ...upload,
    pick: (file) => {
      setProblem(null);
      upload.pick(file);
    },
  };

  /** `POST delivery` exactly once at a time: a ref blocks a second press before React re-renders. */
  async function check(photoUrl: string) {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    try {
      const res = await record.mutateAsync({ needId: need.id, req: { photoUrl, staffNote: note.trim() } });
      if (res.delivery.needsReview) {
        upload.reset();
        setRetaking(null);
        setFocus("review");
        toast.warning("Please review the photo before donors see it.");
      } else {
        toast.success("Delivered. Donors can see the photo now.");
      }
    } catch (error) {
      const message = deliveryErrorMessage(error);
      setProblem(message);
      toast.error(message);
    } finally {
      busy.current = false;
    }
  }

  function retake() {
    if (review) setRetaking(review.id);
    setProblem(null);
    setFocus("photo");
  }

  if (record.isPending) {
    const previewUrl = upload.upload.kind === "ready" ? upload.upload.previewUrl : null;
    return <DeliveryChecking previewUrl={previewUrl} withNote={note.trim() !== ""} />;
  }
  if (review && review.id !== retaking) {
    return (
      <DeliveryReview
        key={review.id}
        need={need}
        delivery={review}
        onRetake={retake}
        focusHeading={focus === "review"}
      />
    );
  }
  return (
    <DeliveryForm
      need={need}
      photo={photo}
      note={note}
      onNoteChange={setNote}
      problem={problem}
      onCheck={(photoUrl) => void check(photoUrl)}
      focusPhoto={focus === "photo"}
    />
  );
}
