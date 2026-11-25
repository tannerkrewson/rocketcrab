import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { Toast } from "@heroui/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Mukta tops out at 800, so font-black (900) uses its heaviest weight.
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/mukta/800.css";
// The brand title uses Inconsolata; the rest of the UI uses Mukta.
import "@fontsource-variable/inconsolata";
import { trackPage } from "./lib/analytics";
import { prepareAppInstall } from "./lib/app-install";
import { guardReplayNavigation, startClarity } from "./lib/clarity";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

prepareAppInstall();

const queryClient = new QueryClient();

const router = createRouter({ routeTree });
guardReplayNavigation(router.history);

router.subscribe("onResolved", () => {
  void startClarity();
  const match = router.state.matches.at(-1);
  if (match !== undefined) {
    trackPage(
      match.status === "notFound" || ("globalNotFound" in match && match.globalNotFound)
        ? "__root__"
        : match.routeId,
      "gameId" in match.params ? match.params.gameId : undefined,
    );
  }
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toast.Provider placement="bottom start" />
      </QueryClientProvider>
    </StrictMode>,
  );
}
