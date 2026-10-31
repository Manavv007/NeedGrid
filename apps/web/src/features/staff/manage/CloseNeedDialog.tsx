import type { NeedCard } from "@needgrid/shared";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { usePatchNeed } from "@/lib/queries";
import { errorMessage } from "../errorMessage";

type CloseNeedDialogProps = {
  need: NeedCard;
  /** The need is closed: the edit dialog closes too and the page takes focus. */
  onClosed: () => void;
};

/**
 * "Close this need…" → confirm → `PATCH { status: "closed" }`. The server refuses while money is
 * attached; its reason stays in this dialog.
 */
export function CloseNeedDialog({ need, onClosed }: CloseNeedDialogProps) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const patch = usePatchNeed();
  const busy = useRef(false);
  const closedNeed = useRef(false);

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    try {
      await patch.mutateAsync({ id: need.id, patch: { status: "closed" } });
      toast.success(`${need.title} is closed.`);
      closedNeed.current = true;
      setOpen(false);
      onClosed();
    } catch (error) {
      const message = errorMessage(error, "We couldn't close this need. Please try again.");
      setProblem(message);
      toast.error(message);
    } finally {
      busy.current = false;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setProblem(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="border-danger/40 text-danger hover:bg-badge-danger-bg hover:text-danger"
        >
          Close this need…
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="gap-4 p-5.5 sm:max-w-md"
        // After a successful close the edit dialog moves focus itself; don't fight it.
        onCloseAutoFocus={(event) => {
          if (closedNeed.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-extrabold">Close {need.title}?</DialogTitle>
          <DialogDescription className="text-soft">It disappears from the public page.</DialogDescription>
        </DialogHeader>
        {problem ? (
          <p
            role="alert"
            className="rounded-md bg-badge-danger-bg px-3 py-2.5 text-sm font-semibold text-badge-danger-text"
          >
            {problem}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Keep it
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={patch.isPending}>
            {patch.isPending ? "Closing…" : "Close need"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
