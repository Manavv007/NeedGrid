import { OrgListRes, paths, STAFF_KEY_HEADER, STAFF_KEY_STORAGE, StaffMeRes } from "@needgrid/shared";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClientError, apiGet, apiPost } from "@/lib/api";
import { setUnauthorizedHandler } from "@/lib/unauthorized";
import { server } from "@/mocks/node";

const API = "http://api.test";

async function expectApiError(promise: Promise<unknown>): Promise<ApiClientError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiClientError);
  return err as ApiClientError;
}

describe("api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a 2xx response with the schema", async () => {
    const res = await apiGet(paths.orgs, OrgListRes);
    expect(res.orgs.map((o) => o.slug)).toContain("harbor-food-bank");
  });

  it("turns an ApiError body into ApiClientError with the server's code", async () => {
    const err = await expectApiError(apiGet(paths.org("nope"), z.unknown()));
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("keeps details from the error body", async () => {
    server.use(
      http.post(`${API}${paths.createOrder}`, () =>
        HttpResponse.json(
          { error: { code: "FULLY_FUNDED", message: "Fully funded", details: { nextNeed: null } } },
          { status: 409 },
        ),
      ),
    );
    const err = await expectApiError(apiPost(paths.createOrder, {}, z.unknown()));
    expect(err).toMatchObject({ status: 409, code: "FULLY_FUNDED", details: { nextNeed: null } });
  });

  it("rejects a 2xx response that doesn't match the contract", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    server.use(http.get(`${API}${paths.orgs}`, () => HttpResponse.json({ orgs: [{ slug: 1 }] })));
    const err = await expectApiError(apiGet(paths.orgs, OrgListRes));
    expect(err.code).toBe("INTERNAL");
  });

  it("maps a network failure to NETWORK after retrying a GET once", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}${paths.orgs}`, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    const err = await expectApiError(apiGet(paths.orgs, OrgListRes));
    expect(err).toMatchObject({ status: 0, code: "NETWORK" });
    expect(calls).toBe(2);
  });

  it("succeeds when the GET retry works (sleeping server)", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}${paths.orgs}`, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.error() : HttpResponse.json({ orgs: [] });
      }),
    );
    await expect(apiGet(paths.orgs, OrgListRes)).resolves.toEqual({ orgs: [] });
  });

  it("does not retry a POST after a network error", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}${paths.createOrder}`, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    const err = await expectApiError(apiPost(paths.createOrder, {}, z.unknown()));
    expect(err.code).toBe("NETWORK");
    expect(calls).toBe(1);
  });

  it("adds the staff header from sessionStorage", async () => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, "paws-demo-2026");
    let seen: string | null = null;
    server.use(
      http.get(`${API}${paths.staff.me}`, ({ request }) => {
        seen = request.headers.get(STAFF_KEY_HEADER);
        return HttpResponse.json({
          org: {
            id: crypto.randomUUID(),
            slug: "x",
            name: "X",
            city: "Y",
            description: "",
            causeTags: [],
            logoUrl: null,
          },
        });
      }),
    );
    await apiGet(paths.staff.me, StaffMeRes, { staff: true });
    expect(seen).toBe("paws-demo-2026");
  });

  it("never sends the staff header on public calls", async () => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, "paws-demo-2026");
    let seen: string | null = "unset";
    server.use(
      http.get(`${API}${paths.orgs}`, ({ request }) => {
        seen = request.headers.get(STAFF_KEY_HEADER);
        return HttpResponse.json({ orgs: [] });
      }),
    );
    await apiGet(paths.orgs, OrgListRes);
    expect(seen).toBeNull();
  });

  it("clears the key and sends the user to sign in on a staff 401", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    sessionStorage.setItem(STAFF_KEY_STORAGE, "wrong-passcode");
    const err = await expectApiError(apiGet(paths.staff.me, StaffMeRes, { staff: true }));
    expect(err).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(sessionStorage.getItem(STAFF_KEY_STORAGE)).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("returns staff data for a demo passcode", async () => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, "harbor-demo-2026");
    const res = await apiGet(paths.staff.me, StaffMeRes, { staff: true });
    expect(res.org.slug).toBe("harbor-food-bank");
  });
});
