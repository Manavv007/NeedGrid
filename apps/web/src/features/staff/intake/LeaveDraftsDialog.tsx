import { useEffect } from "react";
import { useBlocker } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getStaffKey } from "@/lib/staffKey";

type LeaveDraftsDialogProps = {
  /** True while there is work that only lives in this tab (unpublished drafts, a publish in progress). */
  active: boolean;
  /** How many items would be lost, for the message. */
  count: number;
};

/**
 * Drafts only live in the browser until they are published, so leaving the intake page asks first:
 * in-app navigation through the router's blocker, reloads and tab closes through `beforeunload`.
 * A forced sign-out (401: the key is already gone) is never held up.
 */
export function LeaveDraftsDialog({ active, count }: LeaveDraftsDialogProps) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      active && currentLocation.pathname !== nextLocation.pathname && getStaffKey() !== null,
  );

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  const open = blocker.state === "blocked";
  const items = count === 1 ? "1 item" : `${count} items`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && blocker.state === "blocked") blocker.reset();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg font-extrabold">Leave without publishing?</DialogTitle>
          <DialogDescription className="text-soft">
            {items} on this page {count === 1 ? "isn't" : "aren't"} saved yet. They only live in this browser tab, so
            leaving now throws them away.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.state === "blocked" && blocker.proceed()}>
            Leave and discard
          </Button>
          <Button onClick={() => blocker.state === "blocked" && blocker.reset()}>Stay on this page</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
