import { Id, type StaffNeedDetailRes } from "@needgrid/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { Link, useParams } from "react-router";
import { ErrorState } from "@/components/ErrorState";
import { Timeline } from "@/components/Timeline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WakingUp } from "@/components/WakingUp";
import { LiveStatus } from "@/features/live/LiveStatus";
import { useLiveUpdates } from "@/features/live/useLiveUpdates";
import { canEdit } from "@/features/staff/manage/editNeed";
import { EditNeedDialog } from "@/features/staff/manage/EditNeedDialog";
import { NeedBody } from "@/features/staff/manage/NeedBody";
import { NeedHeader } from "@/features/staff/manage/NeedHeader";
import { useStaffOrg } from "@/features/staff/useStaffOrg";
import { ApiClientError } from "@/lib/api";
import { queryKeys, useStaffNeed } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const PAGE = "mx-auto flex w-full max-w-300 flex-col gap-5.5 px-4 pt-5 pb-14 sm:px-6";

const isNotFound = (error: unknown) => error instanceof ApiClientError && error.code === "NOT_FOUND";

/** `/staff/needs/:id`: one need's management page (brief §9.9): edit, purchase plan, order, delivery. */
export function StaffNeedPage() {
  const { id = "" } = useParams();
  // A malformed id is "not found", like the API; no request needed.
  if (!Id.safeParse(id).success) return <StaffNeedNotFound />;
  return <StaffNeedContent key={id} id={id} />;
}

function StaffNeedContent({ id }: { id: string }) {
  const org = useStaffOrg();
  const queryClient = useQueryClient();
  const detail = useStaffNeed(id);
  // The org stream patches public views and staff lists; this page's detail is refetched on its own events.
  const live = useLiveUpdates(org.slug, {
    needId: id,
    onUpdate: ({ card }) => {
      if (card.id === id) void queryClient.invalidateQueries({ queryKey: queryKeys.staffNeed(id) });
    },
  });
  useDocumentTitle(detail.data ? `${detail.data.need.title} · ${org.name} · NeedGrid staff` : null);

  // Data first: a failed background refetch keeps showing what we already have.
  const content = detail.data ? (
    <StaffNeedView detail={detail.data} />
  ) : isNotFound(detail.error) ? (
    <StaffNeedNotFound />
  ) : detail.isError ? (
    <div className={PAGE}>
      <ErrorState className="mt-6" onRetry={() => void detail.refetch()} />
    </div>
  ) : (
    <StaffNeedLoading />
  );

  return (
    <>
      {content}
      <LiveStatus {...live} />
    </>
  );
}

function StaffNeedView({ detail }: { detail: StaffNeedDetailRes }) {
  const { need, timeline } = detail;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const timelineId = useId();

  return (
    <div className={PAGE}>
      <NeedHeader
        need={need}
        headingRef={headingRef}
        actions={
          canEdit(need.status) ? (
            <EditNeedDialog detail={detail} onNeedClosed={() => headingRef.current?.focus()} />
          ) : null
        }
      />
      <NeedBody detail={detail} />
      <section aria-labelledby={timelineId} className="rounded-xl border bg-surface px-4 py-4 sm:px-5.5 sm:py-5">
        <h2 id={timelineId} className="mb-3 text-[17px] font-bold sm:mb-4">
          Where this item is
        </h2>
        <Timeline need={need} events={timeline} />
      </section>
    </div>
  );
}

function StaffNeedNotFound() {
  useDocumentTitle("Need not found · NeedGrid staff");
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <section className="flex max-w-md flex-col items-center gap-3.5 rounded-2xl border bg-surface p-6 text-center">
        <p aria-hidden="true" className="text-[56px] leading-none font-extrabold tracking-[-0.04em] text-primary">
          404
        </p>
        <h1 className="text-xl font-extrabold">We couldn&apos;t find that need</h1>
        <p className="max-w-70 text-sm leading-normal text-soft">
          It may belong to another charity, or the link was mistyped.
        </p>
        <Button asChild>
          <Link to="/staff">Back to needs</Link>
        </Button>
      </section>
    </div>
  );
}

function StaffNeedLoading() {
  return (
    <div role="status" className={PAGE}>
      <span className="sr-only">Loading this need…</span>
      <div aria-hidden="true" className="flex flex-col gap-4 motion-safe:animate-pulse">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-2.5 w-full max-w-md rounded-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
      <WakingUp />
    </div>
  );
}
