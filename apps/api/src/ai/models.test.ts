import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { HttpError } from "../lib/http";
import { cached, setAiModels, withRetry } from "./models";

const apiError = (statusCode: number) =>
  new APICallError({ message: `status ${statusCode}`, url: "https://x", requestBodyValues: {}, statusCode });

describe("withRetry", () => {
  it("retries 429/5xx up to 3 attempts, then 502 UPSTREAM", async () => {
    let n = 0;
    const err = await withRetry(
      async () => {
        n++;
        throw apiError(503);
      },
      { baseDelayMs: 0 },
    ).catch((e: unknown) => e);
    expect(n).toBe(3);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 502, code: "UPSTREAM", message: "The AI service is busy, try again" });
  });

  it("succeeds after a transient failure", async () => {
    let n = 0;
    const v = await withRetry(
      async () => {
        if (++n === 1) throw apiError(429);
        return "ok";
      },
      { baseDelayMs: 0 },
    );
    expect([v, n]).toEqual(["ok", 2]);
  });

  it("does not retry non-retryable errors (e.g. 400, bad JSON)", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw apiError(400);
        },
        { baseDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(n).toBe(1);
  });

  it("passes HttpErrors through unchanged", async () => {
    await expect(
      withRetry(async () => {
        throw new HttpError(400, "VALIDATION", "bad image");
      }),
    ).rejects.toMatchObject({ status: 400, message: "bad image" });
  });

  it("gives each attempt an abort signal that times out", async () => {
    const err = await withRetry(
      (signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
      { attempts: 1, timeoutMs: 20 },
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502 });
  });
});

describe("cached", () => {
  it("returns the cached value for the same feature + input, and doesn't cache failures", async () => {
    setAiModels(null); // clears the cache
    let loads = 0;
    const load = async () => ++loads;
    expect(await cached("f", { a: 1 }, load)).toBe(1);
    expect(await cached("f", { a: 1 }, load)).toBe(1);
    expect(await cached("g", { a: 1 }, load)).toBe(2);
    await expect(cached("h", 1, () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await cached("h", 1, load)).toBe(3);
  });
});
