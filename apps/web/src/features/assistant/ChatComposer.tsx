import { Square } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_MESSAGE_LENGTH } from "./chatItems";

/** The suggested prompts (brief §9.10), shown while the chat is empty. */
export const SUGGESTED_PROMPTS = [
  "Invoice Acme Hardware (sponsor@example.com) for the whole winter-coats list",
  "Check this week's money matches our records",
  "What's still unfunded and urgent?",
] as const;

/** The character counter appears from here on. */
const COUNTER_FROM = 3_600;
const count = new Intl.NumberFormat("en-US");

type ChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  /** Send this text (the box's own text, or a suggestion). */
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  showSuggestions: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

/**
 * The message box (Assistant.dc.html, bottom of the chat): Enter sends, Shift+Enter starts a new
 * line, at most 4000 characters (a counter shows near the limit). The box is locked while a reply
 * streams and Stop appears; when it's usable again it gets the focus back if nothing else has it.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  showSuggestions,
  inputRef,
}: ChatComposerProps) {
  const id = useId();
  const length = value.length;
  const tooLong = length > MAX_MESSAGE_LENGTH;
  const canSend = !streaming && value.trim() !== "" && !tooLong;
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      const active = document.activeElement;
      if (active === null || active === document.body) inputRef.current?.focus();
    }
    wasStreaming.current = streaming;
  }, [streaming, inputRef]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend(value);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend(value);
      }}
      className="sticky bottom-0 flex flex-col gap-2.5 rounded-b-xl border-t border-track bg-surface px-4 pt-3.5 pb-4 sm:px-4.5"
    >
      {showSuggestions ? (
        <ul aria-label="Suggestions" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <li key={prompt}>
              <button
                type="button"
                disabled={streaming}
                onClick={() => onSend(prompt)}
                className="min-h-11 cursor-pointer rounded-full border border-border-strong bg-surface px-3 py-1.5 text-left text-[13px] hover:bg-placeholder disabled:opacity-50"
              >
                {prompt}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-2">
        <label htmlFor={id} className="sr-only">
          Message the assistant
        </label>
        <textarea
          id={id}
          ref={inputRef}
          rows={1}
          value={value}
          disabled={streaming}
          placeholder="Ask in plain English…"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          aria-invalid={tooLong ? true : undefined}
          aria-describedby={`${id}-hint${length >= COUNTER_FROM ? ` ${id}-count` : ""}`}
          className={cn(
            "field-sizing-content max-h-40 min-h-12 min-w-0 flex-1 resize-none rounded-[10px] bg-surface px-3.5 py-3 text-base leading-normal outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-60",
            tooLong ? "border-2 border-danger" : "border border-border-strong",
          )}
        />
        <Button type="submit" size="lg" disabled={!canSend} className="h-12 px-4 sm:px-5">
          Send
        </Button>
        {streaming ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onStop}
            aria-label="Stop the reply"
            className="h-12 px-3.5"
          >
            <Square aria-hidden="true" className="size-3" fill="currentColor" />
            Stop
          </Button>
        ) : null}
      </div>
      <p id={`${id}-hint`} className="sr-only">
        Enter sends. Shift and Enter starts a new line.
      </p>
      {length >= COUNTER_FROM ? (
        <p id={`${id}-count`} className={cn("text-xs text-muted-foreground", tooLong && "font-semibold text-danger")}>
          {count.format(length)}/{count.format(MAX_MESSAGE_LENGTH)} characters
          {tooLong ? `. Keep it to ${count.format(MAX_MESSAGE_LENGTH)} or fewer.` : ""}
        </p>
      ) : null}
    </form>
  );
}
