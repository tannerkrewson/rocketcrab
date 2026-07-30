import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [
        tailwindcss(),
        tanstackStart({
            srcDirectory: "app",
        }),
    ],
    server: {
        port: 3001,
    },
});
