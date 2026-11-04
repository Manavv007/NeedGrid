import { describe, expect, it } from "vitest";
import { ApiClientError, NETWORK_MESSAGE } from "@/lib/api";
import {
  audienceForPath,
  errorCopy,
  GENERIC_COPY,
  NETWORK_COPY,
  NOT_LIVE_COPY,
  RATE_LIMITED_COPY,
  reloadCopy,
  SERVER_COPY,
} from "@/lib/errorCopy";

const network = new ApiClientError(0, "NETWORK", NETWORK_MESSAGE);
const internal = new ApiClientError(500, "INTERNAL", "boom");
const upstream = new ApiClientError(503, "UPSTREAM", "Database briefly unavailable");
const contract = new ApiClientError(200, "INTERNAL", "The server sent something we didn't expect.");
const missingRoute = new ApiClientError(404, "NOT_FOUND", "Request failed (404).");
const limited = new ApiClientError(429, "RATE_LIMITED", "Too many requests");
const refused = new ApiClientError(400, "VALIDATION", "Bad id");

describe("errorCopy", () => {
  it("network: check your connection, and donors hear their gifts are safe", () => {
    expect(errorCopy(network, "donor")).toEqual({ message: `${NETWORK_COPY} Your gifts are safe.`, tone: "error" });
    expect(errorCopy(network, "staff")).toEqual({ message: NETWORK_COPY, tone: "error" });
  });

  it("5xx and contract mismatches: our side, not the donor's connection", () => {
    for (const error of [internal, upstream, contract]) {
      expect(errorCopy(error, "donor").message).toBe(`${SERVER_COPY} Your gifts are safe.`);
      expect(errorCopy(error, "staff")).toEqual({ message: SERVER_COPY, tone: "error" });
    }
    expect(SERVER_COPY).toBe("Something went wrong on our side. Please try again in a moment.");
  });

  it("a 404 on a staff list of a feature that may be off: a calm notice", () => {
    expect(errorCopy(missingRoute, "staff", { optionalFeature: true })).toEqual({
      title: "Not available yet",
      message: NOT_LIVE_COPY,
      tone: "notice",
    });
    expect(NOT_LIVE_COPY).toBe("This part isn't switched on yet. It will show up here once it's live.");
  });

  it("only 404s count as 'not switched on yet'; other failures on those lists are real errors", () => {
    expect(errorCopy(internal, "staff", { optionalFeature: true })).toEqual({ message: SERVER_COPY, tone: "error" });
    expect(errorCopy(network, "staff", { optionalFeature: true })).toEqual({ message: NETWORK_COPY, tone: "error" });
    expect(errorCopy(missingRoute, "staff")).toEqual({ message: GENERIC_COPY, tone: "error" });
  });

  it("429 asks to wait; anything else gets a plain 'try again'", () => {
    expect(errorCopy(limited, "staff").message).toBe(RATE_LIMITED_COPY);
    expect(errorCopy(refused, "staff").message).toBe(GENERIC_COPY);
    expect(errorCopy(new Error("odd"), "staff").message).toBe(GENERIC_COPY);
    expect(errorCopy(null, "donor").message).toBe(`${GENERIC_COPY} Your gifts are safe.`);
  });

  it("staff copy never says 'gifts are safe'", () => {
    const errors = [network, internal, upstream, contract, missingRoute, limited, refused, new Error("x"), null];
    for (const error of errors) {
      expect(errorCopy(error, "staff").message).not.toMatch(/gifts are safe/i);
      expect(errorCopy(error, "staff", { optionalFeature: true }).message).not.toMatch(/gifts are safe/i);
    }
    expect(reloadCopy("staff")).toBe("Reload the page to try again.");
  });
});

describe("audienceForPath", () => {
  it("staff pages are under /staff; everything else is public", () => {
    expect(audienceForPath("/staff")).toBe("staff");
    expect(audienceForPath("/staff/invoices")).toBe("staff");
    expect(audienceForPath("/staff/login")).toBe("staff");
    expect(audienceForPath("/")).toBe("donor");
    expect(audienceForPath("/o/harbor-food-bank/flyer")).toBe("donor");
    expect(audienceForPath("/staffing")).toBe("donor");
    expect(reloadCopy("donor")).toBe("Reload the page to try again. Your gifts are safe.");
  });
});
