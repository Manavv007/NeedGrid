import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { clearOwnChanges } from "@/lib/ownChanges";

// findBy*/waitFor give up after 1 s by default; a busy machine running the whole suite (API tests in
// parallel) can take longer than that to render a full route, which made tests flaky, not wrong.
configure({ asyncUtilTimeout: 3_000 });

// The same MSW handlers as the browser. Any request without a handler fails the test.
beforeAll(() => {
  // jsdom doesn't implement scrolling; React Router's ScrollRestoration calls it on every navigation.
  window.scrollTo = () => undefined;
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  mockDb.reset();
  clearOwnChanges();
  sessionStorage.clear();
});

afterAll(() => server.close());
