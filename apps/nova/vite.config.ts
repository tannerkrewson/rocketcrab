import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The TanStack Router Vite plugin MUST be registered before the React plugin.
// Route tests are colocated with routes (repo convention) and are excluded
// from route-tree generation via the ignore pattern.
export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", routeFileIgnorePattern: ".*\\.test\\.tsx$" }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
  },
});
