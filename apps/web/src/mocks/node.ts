import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/** Node mock API for tests: the same handlers as the browser worker. */
export const server = setupServer(...handlers);
