/**
 * The staff assistant's loop (AGENT_B_AI_DATA.md §9.6): at most MAX_STEPS model calls; between them WE run the tools
 * the model asked for (tools.ts) and stream what happens as AgentStreamEvent lines.
 *
 * Each step is one generateText call through callModel, not one long streamText: on the free tier a step that hits a
 * quota can fall back to the next model, which a started stream can't. So text arrives one step at a time (a delta per
 * step) rather than token by token; C's chat treats any delta size the same.
 *
 * Guardrails: the org comes from the staff passcode; staff messages are wrapped as untrusted; tool results (which
 * contain titles typed or extracted from photos) are wrapped as untrusted; at most one money proposal per message;
 * money tools only PROPOSE (A's approve endpoint executes).
 */
import { AgentStreamEvent, type AgentChatReq } from "@needgrid/shared";
import { generateText, tool, type ModelMessage, type ToolSet } from "ai";
import { HttpError } from "../../lib/http";
import { CallCancelled, callModel } from "../models";
import { wrapUntrusted } from "../untrusted";
import { assistantSystemPrompt } from "./systemPrompt";
import { assistantTools, type ToolDeps, type ToolOutcome } from "./tools";

export const MAX_STEPS = 6;
export const MAX_PROPOSALS_PER_MESSAGE = 1;
export const GENERIC_ERROR = "Sorry, the assistant hit a problem and stopped.";
export const TOO_MANY_STEPS = "I couldn't finish that in a few steps. Could you make the request more specific?";
export const EMPTY_REPLY = "I couldn't finish that. Please try again, or rephrase the request.";
/** Our own text (not the staff's), so it isn't wrapped as untrusted. */
const CONTINUE =
  "(NeedGrid: your last reply was empty. Continue the staff member's request: call the next tool, or answer them in one or two sentences.)";
const ONE_PROPOSAL =
  "Only one money action can be proposed per message. Tell the staff member the first one is waiting on its approval card, and that they can ask for the next one in a new message.";
const MAX_TOOL_RESULT_CHARS = 20_000;

export interface ChatInput {
  org: { id: string; name: string };
  messages: AgentChatReq["messages"];
  write: (event: AgentStreamEvent) => void;
  signal?: AbortSignal;
  now?: Date;
  /** Tests: the tools' database reads. */
  deps?: ToolDeps;
}

export function toModelHistory(messages: AgentChatReq["messages"]): ModelMessage[] {
  return messages.map((m) =>
    m.role === "user"
      ? { role: "user", content: wrapUntrusted("staff_message", m.content, 4000) }
      : { role: "assistant", content: m.content },
  );
}

/** Streams one reply. Never throws; always ends with `done` unless the client went away. */
export async function runAssistantChat({ org, messages: history, write, signal, now, deps }: ChatInput): Promise<void> {
  const emit = (event: AgentStreamEvent) => {
    if (!signal?.aborted) write(AgentStreamEvent.parse(event));
  };
  const tools = assistantTools(org, deps);
  const toolSet: ToolSet = Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [name, tool({ description: t.description, inputSchema: t.inputSchema })]),
  );
  const instructions = assistantSystemPrompt(org, now);
  const messages = toModelHistory(history);
  let wroteText = false;
  let nudged = false;
  let proposals = 0;
  const say = (text: string) => {
    const t = text.trim();
    if (!t) return;
    emit({ type: "text", delta: wroteText ? `\n\n${t}` : t });
    wroteText = true;
  };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const result = await callModel(
        ({ model, signal: callSignal, providerOptions }) =>
          generateText({
            model,
            instructions,
            messages,
            tools: toolSet,
            toolChoice: "auto",
            temperature: 0.2,
            maxOutputTokens: 1024,
            maxRetries: 0,
            abortSignal: callSignal,
            providerOptions,
          }),
        { label: "assistant", thinkingBudget: 512, abortSignal: signal, waitForQuotaMs: 20_000 },
      );
      say(result.text);
      if (result.toolCalls.length === 0) {
        // Live (Nov 1): flash-lite sometimes answers a tool result with nothing at all. Nudge it once, then give up
        // with a plain sentence, so a reply never ends in silence.
        if (result.text.trim() || nudged || step === MAX_STEPS - 1) {
          if (!result.text.trim()) say(EMPTY_REPLY);
          break;
        }
        nudged = true;
        // The empty reply itself isn't replayed (Gemini rejects a turn without parts).
        messages.push({ role: "user", content: CONTINUE });
        continue;
      }

      messages.push(...result.response.messages);
      // The SDK may already have answered an invalid call with a tool-error result; don't answer it twice.
      const answered = new Set(
        result.response.messages.flatMap((m) =>
          m.role === "tool" ? m.content.flatMap((p) => (p.type === "tool-result" ? [p.toolCallId] : [])) : [],
        ),
      );
      const results: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "text"; value: string };
      }> = [];
      for (const call of result.toolCalls) {
        if (answered.has(call.toolCallId)) continue;
        const t = tools[call.toolName];
        let out: ToolOutcome;
        if (!t) {
          out = { forModel: { error: `There is no tool named ${call.toolName}` }, summary: "" };
        } else {
          emit({ type: "tool_call", tool: call.toolName, summary: t.startSummary });
          if (t.kind === "propose" && proposals >= MAX_PROPOSALS_PER_MESSAGE) {
            out = { forModel: { error: ONE_PROPOSAL }, summary: "Skipped: one approval card at a time" };
          } else if ("invalid" in call && call.invalid) {
            out = {
              forModel: { error: "The arguments didn't match the tool's input" },
              summary: "Couldn't run that step",
            };
          } else {
            out = await t.run(call.input);
            if (out.action) proposals++;
          }
          emit(
            out.data === undefined
              ? { type: "tool_result", tool: call.toolName, summary: out.summary }
              : { type: "tool_result", tool: call.toolName, summary: out.summary, data: out.data },
          );
          if (out.action) emit({ type: "action_proposed", action: out.action });
        }
        results.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: {
            type: "text",
            value: wrapUntrusted("tool_result", JSON.stringify(out.forModel), MAX_TOOL_RESULT_CHARS),
          },
        });
      }
      if (results.length > 0) messages.push({ role: "tool", content: results });
      if (step === MAX_STEPS - 1) say(TOO_MANY_STEPS);
    }
  } catch (err) {
    if (err instanceof CallCancelled || signal?.aborted) return;
    // Details stay in the server log; staff get a plain message (the quota messages are already plain).
    console.error("[assistant] chat failed:", (err as Error).message?.slice(0, 300));
    emit({ type: "error", message: err instanceof HttpError && err.status === 503 ? err.message : GENERIC_ERROR });
  }
  emit({ type: "done" });
}
