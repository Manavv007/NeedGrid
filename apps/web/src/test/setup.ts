import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";

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
  sessionStorage.clear();
});

afterAll(() => server.close());
