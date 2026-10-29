/** Test doubles for the AI SDK. Use with setAiModels({ language: scriptedModel(...) }). No network. */
import { MockLanguageModelV4 } from "ai/test";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

export interface ModelCall {
  /** The whole prompt (instructions + messages) as JSON, for assertions and routing. */
  promptJson: string;
  temperature: number | undefined;
}

/**
 * A language model whose reply is decided by `reply(call)`: return an object (sent back as JSON text), a string
 * (sent as-is) or throw to simulate a provider failure. Every call is recorded in `.calls`.
 */
export function scriptedModel(reply: (call: ModelCall) => unknown) {
  const calls: ModelCall[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const call: ModelCall = { promptJson: JSON.stringify(options.prompt), temperature: options.temperature };
      calls.push(call);
      const out = reply(call);
      return {
        content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return Object.assign(model, { calls });
}

/** Which B feature a call belongs to, from its system prompt. */
export function featureOf(call: ModelCall): "intake" | "rank" | "unknown" {
  if (call.promptJson.includes("You turn a charity's needs list")) return "intake";
  if (call.promptJson.includes("You help a charity pick")) return "rank";
  return "unknown";
}
