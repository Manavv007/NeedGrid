import type { NeedCard } from "@needgrid/shared";
import { useRef } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ProductPhoto } from "@/components/ProductPhoto";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDonorCount, formatRelativeTime, formatUsdShort } from "@/lib/format";
import { staffNeedPath } from "@/lib/links";
import { usePatchNeed } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { errorMessage } from "../errorMessage";

type NeedsTableProps = { needs: readonly NeedCard[] };

const COMPLETE: readonly NeedCard["status"][] = ["funded", "ordered", "delivered"];

/**
 * Staff view of needs (StaffConsole.dc.html). The table scrolls inside its own box on phones so the
 * page itself never scrolls sideways. Every amount is the server's.
 */
export function NeedsTable({ needs }: NeedsTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <Table className="min-w-170">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="h-11 px-4">
              Item
            </TableHead>
            <TableHead scope="col" className="h-11">
              Raised
            </TableHead>
            <TableHead scope="col" className="h-11">
              Status
            </TableHead>
            <TableHead scope="col" className="h-11">
              Updated
            </TableHead>
            <TableHead scope="col" className="h-11 px-4">
              <span className="sr-only">Next step</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {needs.map((need) => (
            <NeedRow key={need.id} need={need} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NeedRow({ need }: { need: NeedCard }) {
  return (
    <TableRow>
      <TableCell className="px-4 py-3">
        <div className="flex items-center gap-3">
          <ProductPhoto
            product={need.product}
            className="size-11 rounded-lg border"
            placeholderClassName="rounded-lg"
            iconClassName="size-5"
          />
          <span className="flex min-w-0 flex-col">
            <Link to={staffNeedPath(need.id)} className="max-w-56 truncate text-sm text-foreground">
              <strong>{need.title}</strong>
            </Link>
            <span className="text-[13px] text-muted-foreground">
              {need.quantity} × {need.unit}
            </span>
          </span>
        </div>
      </TableCell>
      <TableCell className="py-3">
        <div className="flex min-w-36 flex-col gap-1.5">
          <ProgressBar
            fundedCents={need.fundedCents}
            heldCents={need.heldCents}
            targetCents={need.targetCents}
            label={`${need.title} funding`}
            size="sm"
            complete={COMPLETE.includes(need.status)}
          />
          <span className="text-[13px] text-soft">
            {formatUsdShort(need.fundedCents)} of {formatUsdShort(need.targetCents)} <span aria-hidden="true">·</span>{" "}
            {formatDonorCount(need.donorCount)}
          </span>
        </div>
      </TableCell>
      <TableCell className="py-3">
        <StatusBadge status={need.status} />
      </TableCell>
      <TableCell className="py-3 text-[13px] text-soft">
        <time dateTime={need.updatedAt}>{formatRelativeTime(need.updatedAt)}</time>
      </TableCell>
      <TableCell className="px-4 py-3 text-right">
        <NextStep need={need} />
      </TableCell>
    </TableRow>
  );
}

const rowLink = cn(buttonVariants({ variant: "secondary", size: "sm" }));

/** One next action per row: Publish a draft, plan the purchase when funded, record the delivery when ordered. */
function NextStep({ need }: { need: NeedCard }) {
  const manage = staffNeedPath(need.id);
  switch (need.status) {
    case "draft":
      return need.product ? (
        <PublishButton need={need} />
      ) : (
        <span className="text-[13px] text-muted-foreground">Needs a product</span>
      );
    case "funded":
      return (
        <Link to={manage} className={rowLink} aria-label={`Plan purchase for ${need.title}`}>
          Plan purchase
        </Link>
      );
    case "ordered":
      return (
        <Link to={manage} className={rowLink} aria-label={`Record delivery for ${need.title}`}>
          Record delivery
        </Link>
      );
    default:
      return (
        <Link
          to={manage}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          aria-label={`Manage ${need.title}`}
        >
          Manage
        </Link>
      );
  }
}

/** `PATCH { status: "open" }`. One request at a time per row; the list refreshes and the row moves to Open. */
function PublishButton({ need }: { need: NeedCard }) {
  const patch = usePatchNeed();
  const busy = useRef(false);

  async function publish() {
    if (busy.current) return;
    busy.current = true;
    try {
      await patch.mutateAsync({ id: need.id, patch: { status: "open" } });
      toast.success(`${need.title} is live on your public page.`);
    } catch (error) {
      toast.error(errorMessage(error, "We couldn't publish that. Please try again."));
    } finally {
      busy.current = false;
    }
  }

  return (
    <Button size="sm" onClick={() => void publish()} disabled={patch.isPending} aria-label={`Publish ${need.title}`}>
      {patch.isPending ? "Publishing…" : "Publish"}
    </Button>
  );
}
