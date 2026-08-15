import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
// Mukta is the single UI font (rocketcrab-9fv.10.2). Static weights cover
// everything the app uses: regular (400), medium (500), semibold (600),
// bold (700), and extra-bold (800) — Mukta tops out at 800, so font-black
// (900) headings render at its heaviest weight.
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/500.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/mukta/800.css";
// Inconsolata Variable (200-900) is the monospace brand font for the
// rocketcrab.com homepage title only (rocketcrab-9fv.11.5); the rest of the
// UI keeps Mukta. The `font-title` utility in styles.css references it.
import "@fontsource-variable/inconsolata";
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

/**
 * Sonner toaster with the app-wide toast behavior (rocketcrab-2t1.3):
 * bottom-left placement, and tapping ANYWHERE on a toast dismisses it.
 *
 * Sonner 2.0.7 has no per-toast onClick (verified against its types), so a
 * delegated listener on the toaster container matches the clicked toast's
 * DOM `data-index` back to its id via `toast.getToasts()` and dismisses it.
 * New toasts are prepended by sonner, so DOM index 0 (front toast)
 * corresponds to the LAST entry of `getToasts()`. Clicks on the toast's own
 * interactive controls (action/cancel/close buttons, links, inputs) are
 * left alone so toast actions keep working.
 */
function TapToDismissToaster() {
  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const toastEl = event.target.closest("[data-sonner-toast]");
      if (toastEl === null) return;
      // Never hijack clicks on the toast's own interactive controls.
      if (
        event.target.closest(
          "button, a, input, textarea, select, [role='button'], [data-close-button]",
        ) !== null
      ) {
        return;
      }
      const index = Number(toastEl.getAttribute("data-index"));
      if (!Number.isFinite(index)) return;
      const activeToasts = toast.getToasts();
      const target = activeToasts[activeToasts.length - 1 - index];
      if (target !== undefined) {
        toast.dismiss(target.id);
      }
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  return (
    <Toaster
      position="bottom-left"
      richColors
      toastOptions={{ classNames: { toast: "cursor-pointer" } }}
    />
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <TapToDismissToaster />
      </QueryClientProvider>
    </StrictMode>,
  );
}
