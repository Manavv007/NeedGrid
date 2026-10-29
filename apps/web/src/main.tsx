import "@fontsource-variable/inter";
import "./styles/globals.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { env, envResult } from "@/env";
import { createQueryClient } from "@/lib/queryClient";
import { registerUnauthorizedRedirect } from "@/lib/staffSession";
import { ConfigErrorScreen } from "@/pages/ConfigErrorScreen";
import { createAppRouter } from "@/router";

async function startMocks(): Promise<void> {
  // Dynamic import behind the env check: mock code is not in the bundle when mocks are off.
  const { startMockApi } = await import("./mocks/browser");
  await startMockApi();
}

async function main(): Promise<void> {
  const container = document.getElementById("root");
  if (!container) throw new Error("#root element missing from index.html");
  const root = createRoot(container);

  if (!envResult.ok) {
    root.render(<ConfigErrorScreen problems={envResult.problems} />);
    return;
  }

  // Compile-time check first so Vite drops the mock import (and its chunk) from builds with mocks off.
  if (import.meta.env.VITE_USE_MOCKS === "true" && env.VITE_USE_MOCKS) await startMocks();

  const router = createAppRouter();
  const queryClient = createQueryClient();
  registerUnauthorizedRedirect(router, queryClient);

  root.render(
    <StrictMode>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
          <Toaster position="top-center" />
        </QueryClientProvider>
      </AppErrorBoundary>
    </StrictMode>,
  );
}

void main();
