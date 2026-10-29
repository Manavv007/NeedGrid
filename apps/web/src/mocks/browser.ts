import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

/** Browser mock API, started by main.tsx when VITE_USE_MOCKS=true. */
export const worker = setupWorker(...handlers);
