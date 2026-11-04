import { describe, expect, it, vi } from "vitest";
import { hashStaffKey, safeEqualHex } from "./crypto";
import { assertCloudinaryUrl, HttpError } from "./http";

describe("hashStaffKey", () => {
  it("is lowercase SHA-256 hex of the UTF-8 passcode (B's seed must match)", () => {
    expect(hashStaffKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashStaffKey("harbor-demo-2026")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("safeEqualHex compares digests", () => {
    const h = hashStaffKey("x");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashStaffKey("y"))).toBe(false);
    expect(safeEqualHex(h, "")).toBe(false);
  });
});

describe("assertCloudinaryUrl (CLOUDINARY_CLOUD_NAME=demo in tests)", () => {
  it("accepts our cloud", () => {
    expect(() => assertCloudinaryUrl("https://res.cloudinary.com/demo/image/upload/v1/needgrid/a.jpg")).not.toThrow();
  });
  it.each([
    "http://res.cloudinary.com/demo/image/upload/a.jpg", // not https
    "https://res.cloudinary.com/other/image/upload/a.jpg", // other cloud
    "https://res.cloudinary.com.evil.com/demo/a.jpg", // lookalike host
    "https://user:pw@res.cloudinary.com/demo/a.jpg", // credentials
    "https://169.254.169.254/latest/meta-data", // SSRF target
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => assertCloudinaryUrl(url)).toThrow(HttpError);
  });
});

describe("isConnectionError", () => {
  it("recognises dropped connections, including drizzle-wrapped and dual-stack AggregateErrors", async () => {
    const { isConnectionError } = await import("./dbErrors");
    const agg = Object.assign(
      new AggregateError([Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })], ""),
      {},
    );
    expect(isConnectionError(agg)).toBe(true);
    expect(isConnectionError({ message: "Failed query: x", cause: agg })).toBe(true);
    expect(isConnectionError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isConnectionError(Object.assign(new Error("dup"), { code: "23505" }))).toBe(false);
    expect(isConnectionError(new Error("boom"))).toBe(false);
  });
});

describe("isConnectFailure / retryConnectFailures", () => {
  it("only connect-phase failures count (mid-query drops are not retried: the write may have run)", async () => {
    const { isConnectFailure } = await import("./dbErrors");
    const connectTimeout = Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:5432"), {
      code: "ETIMEDOUT",
      syscall: "connect",
    });
    expect(isConnectFailure(new AggregateError([connectTimeout, connectTimeout], ""))).toBe(true);
    expect(isConnectFailure({ message: "Failed query", cause: connectTimeout })).toBe(true);
    expect(isConnectFailure(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isConnectFailure(new Error("Connection terminated unexpectedly"))).toBe(false);
    expect(isConnectFailure(new Error("Query read timeout"))).toBe(false);
  });

  it("retries the query after a connect failure, not after other errors", async () => {
    const { retryConnectFailures } = await import("./dbErrors");
    let calls = 0;
    const pool = {
      query: async () => {
        calls++;
        if (calls === 1) throw new Error("timeout exceeded when trying to connect");
        return { rows: [1] };
      },
    };
    retryConnectFailures(pool);
    await expect(pool.query()).resolves.toEqual({ rows: [1] });
    expect(calls).toBe(2);

    let calls2 = 0;
    const pool2 = {
      query: async () => {
        calls2++;
        throw Object.assign(new Error("dup"), { code: "23505" });
      },
    };
    retryConnectFailures(pool2);
    await expect(pool2.query()).rejects.toThrow("dup");
    expect(calls2).toBe(1);
  });
});

describe("withTxRetry", () => {
  it("retries a transaction whose connection couldn't open (e.g. DNS ENOTFOUND), never one that dropped mid-way", async () => {
    vi.useFakeTimers();
    try {
      const { withTxRetry } = await import("../money/ledger");
      const dns = Object.assign(new Error("getaddrinfo ENOTFOUND ep-x.neon.tech"), {
        code: "ENOTFOUND",
        syscall: "getaddrinfo",
      });
      let calls = 0;
      const ok = withTxRetry(async () => {
        calls++;
        if (calls < 3) throw dns;
        return "done";
      });
      await vi.runAllTimersAsync();
      await expect(ok).resolves.toBe("done");
      expect(calls).toBe(3);

      let calls2 = 0;
      const dropped = withTxRetry(async () => {
        calls2++;
        throw new Error("Connection terminated unexpectedly");
      });
      const assertion = expect(dropped).rejects.toThrow("Connection terminated");
      await vi.runAllTimersAsync();
      await assertion;
      expect(calls2).toBe(1); // the COMMIT might have happened: never re-run money logic
    } finally {
      vi.useRealTimers();
    }
  });
});
