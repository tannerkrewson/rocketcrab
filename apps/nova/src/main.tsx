import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { normalizeBasePath } from "./lib/basepath";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const queryClient = new QueryClient();

// Match routes under the deployment base path: "/" normally, "/<repo>/"
// for GitHub Pages project-site layouts (M2 deployment, normalizeBasePath).
const router = createRouter({
  routeTree,
  basepath: normalizeBasePath(import.meta.env.BASE_URL),
});

// Register the router instance for type-safe typed routes.
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
        <Toaster position="top-center" richColors />
      </QueryClientProvider>
    </StrictMode>,
  );
}
