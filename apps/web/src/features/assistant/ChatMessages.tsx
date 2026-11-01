import { Check, Minus } from "lucide-react";
import { useEffect, useState } from "react";
import { WAKING_UP_DELAY_MS } from "@/components/WakingUp";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./ApprovalCard";
import { lastTurn, type ChatItem } from "./chatItems";
import { ReconcileReportTable } from "./ReconcileReportTable";

type ChatMessagesProps = {
  items: readonly ChatItem[];
  streaming: boolean;
  orgName: string;
  /** "Ask again" on a failed card: put this request back in the chat box. */
  onAskAgain: (requestText: string) => void;
};

/**
 * The conversation (Assistant.dc.html): staff on the right, the assistant on the left, tool status
 * lines, reconcile tables and approval cards in between. Everything is plain text with its line
 * breaks kept: no markdown, no HTML. This list isn't a live region (every streamed word would be
 * read out); the chat's own announcer reads whole sentences instead.
 */
export function ChatMessages({ items, streaming, orgName, onAskAgain }: ChatMessagesProps) {
  const turn = lastTurn(items);
  const waitingForFirstWord = streaming && !items.some((item) => item.turn === turn && item.kind !== "user");
  return (
    <ol aria-label="Conversation" className="m-0 flex list-none flex-col gap-4 p-0">
      {items.map((item) => (
        <ChatEntry key={item.id} item={item} orgName={orgName} onAskAgain={onAskAgain} />
      ))}
      {waitingForFirstWord ? (
        <li>
          <Thinking />
        </li>
      ) : null}
    </ol>
  );
}

const bubble = "max-w-[85%] px-3.5 py-3 text-[15px] leading-normal whitespace-pre-wrap wrap-anywhere";

function ChatEntry({
  item,
  orgName,
  onAskAgain,
}: {
  item: ChatItem;
  orgName: string;
  onAskAgain: (text: string) => void;
}) {
  switch (item.kind) {
    case "user":
      return (
        <li
          className={cn(bubble, "max-w-[78%] self-end rounded-[14px_14px_4px_14px] bg-primary text-primary-foreground")}
        >
          <span className="sr-only">You: </span>
          {item.text}
        </li>
      );
    case "assistant":
      return (
        <li className={cn(bubble, "self-start rounded-[14px_14px_14px_4px] bg-staff-bg")}>
          <span className="sr-only">Assistant: </span>
          {item.text}
        </li>
      );
    case "tool":
      return (
        <li className="flex flex-col gap-3 self-stretch">
          <p className="flex items-center gap-2 self-start text-[13px] text-muted-foreground">
            <ToolState state={item.state} />
            <span>
              {item.summary}
              {item.state === "stopped" ? " (stopped)" : ""}
            </span>
          </p>
          {item.report ? <ReconcileReportTable report={item.report} /> : null}
        </li>
      );
    case "action":
      return (
        <li className="self-stretch">
          <ApprovalCard
            action={item.action}
            variant="inline"
            orgName={orgName}
            onAskAgain={() => onAskAgain(item.requestText)}
          />
        </li>
      );
    case "error":
      return (
        <li className="max-w-[85%] self-start">
          <div
            role="alert"
            className="rounded-[14px_14px_14px_4px] bg-badge-danger-bg px-3 py-2.5 text-sm leading-normal text-badge-danger-text"
          >
            {item.message}
            {item.fromStream ? " Your data is fine. Please try again." : ""}
          </div>
        </li>
      );
    case "note":
      return <li className="self-start text-[13px] text-muted-foreground italic">{item.text}</li>;
  }
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-3.5 shrink-0 rounded-full border-2 border-held border-t-primary motion-safe:animate-spin"
    />
  );
}

function ToolState({ state }: { state: "running" | "done" | "stopped" }) {
  if (state === "running") {
    return (
      <>
        <Spinner />
        <span className="sr-only">Working: </span>
      </>
    );
  }
  if (state === "done") {
    return (
      <>
        <Check aria-hidden="true" className="size-3.5 shrink-0 text-success" strokeWidth={3} />
        <span className="sr-only">Done: </span>
      </>
    );
  }
  return <Minus aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={3} />;
}

/** Before the first word: "Thinking…", then (the free server may be asleep) "Waking up the server…". */
function Thinking() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), WAKING_UP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <Spinner />
      {slow ? "Waking up the server… the first reply can take up to a minute." : "Thinking…"}
    </p>
  );
}
