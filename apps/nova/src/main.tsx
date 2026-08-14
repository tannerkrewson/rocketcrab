import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
// Mukta is the single UI font (rocketcrab-9fv.10.2). Static weights cover
// everything the app uses: regular (400), medium (500), semibold (600),
// bold (700), and extra-bold (800) — Mukta tops out at 800, so font-black
// (900) headings render at its heaviest weight.
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/mukta/800.css";
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
