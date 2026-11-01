import type { AgentAction } from "@needgrid/shared";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/features/assistant/ChatComposer";
import { ChatMessages } from "@/features/assistant/ChatMessages";
import { PendingActions } from "@/features/assistant/PendingActions";
import { useAssistantChat } from "@/features/assistant/useAssistantChat";
import { useStaffOrg } from "@/features/staff/useStaffOrg";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "@/lib/useMediaQuery";

const PAGE = "mx-auto w-full max-w-300 px-4 pt-6 pb-12 sm:px-6";
/** Within this many pixels of the bottom, new messages keep the page scrolled to the newest one. */
const STICK_TO_BOTTOM_PX = 200;

/**
 * `/staff/assistant` (brief §9.10, Assistant.dc.html): the chat on the left and Pending approvals on
 * the right; on phones one column with the approvals (collapsed) above the chat. The assistant can
 * read and propose; money only moves when staff approve a card.
 */
export function AssistantPage() {
  const org = useStaffOrg();
  useDocumentTitle(`Assistant · ${org.name} · NeedGrid staff`);
  const chat = useAssistantChat(org.id);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, false);

  useEffect(() => {
    const onScroll = () => {
      const { scrollHeight } = document.documentElement;
      atBottom.current = window.innerHeight + window.scrollY >= scrollHeight - STICK_TO_BOTTOM_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Follow the reply as it streams, unless staff scrolled up to read something.
  useEffect(() => {
    const end = endRef.current;
    if (!atBottom.current || !end || typeof end.scrollIntoView !== "function") return;
    end.scrollIntoView({ block: "end", behavior: reducedMotion ? "auto" : "smooth" });
  }, [chat.items, reducedMotion]);

  function send(text: string) {
    if (!chat.send(text)) return;
    setDraft("");
    atBottom.current = true;
  }

  function askAgain(text: string) {
    setDraft(text);
    inputRef.current?.focus();
  }

  /** The request that led to `action` when it was proposed in this chat, else its title. */
  function askAgainFor(action: AgentAction) {
    const item = chat.items.find((i) => i.kind === "action" && i.action.id === action.id);
    askAgain(item?.kind === "action" ? item.requestText : action.preview.title);
  }

  return (
    <div className={PAGE}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-[-0.03em]">Assistant</h1>
          <p className="mt-1 text-sm text-soft">Ask in plain English. Every money action waits for your approval.</p>
        </div>
        <Button variant="outline" onClick={chat.newChat} disabled={chat.streaming || chat.items.length === 0}>
          <MessageSquarePlus aria-hidden="true" />
          New chat
        </Button>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="min-w-0 lg:order-2">
          <PendingActions orgName={org.name} onAskAgain={askAgainFor} />
        </div>

        <section
          aria-label="Chat"
          className="flex min-h-[60svh] min-w-0 flex-col rounded-xl border bg-surface lg:order-1"
        >
          <div className="flex-1 p-4 sm:p-5.5">
            {chat.items.length === 0 ? (
              <Welcome />
            ) : (
              <ChatMessages items={chat.items} streaming={chat.streaming} orgName={org.name} onAskAgain={askAgain} />
            )}
            <div ref={endRef} className="scroll-mb-40" />
          </div>
          <p aria-live="polite" className="sr-only">
            {chat.announcement}
          </p>
          <ChatComposer
            value={draft}
            onChange={setDraft}
            onSend={send}
            onStop={chat.stop}
            streaming={chat.streaming}
            showSuggestions={chat.items.length === 0}
            inputRef={inputRef}
          />
        </section>
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl bg-staff-bg p-4.5">
      <Sparkles aria-hidden="true" className="size-5 text-primary" />
      <h2 className="text-base font-extrabold">Ask the assistant</h2>
      <p className="max-w-130 text-sm leading-normal text-soft">
        It can prepare sponsor invoices, check PayPal against your records, and tell you what's still needed. It can't
        move money: every money action waits here for you to approve it.
      </p>
    </div>
  );
}
