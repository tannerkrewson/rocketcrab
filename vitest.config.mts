import { defineConfig } from "vitest/config";

export default defineConfig({
    oxc: {
        jsx: { importSource: "react" },
    },
    test: {
        environment: "jsdom",
        globals: true,
        include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
        exclude: [
            "node_modules",
            ".next",
            "test/pages/**",
            "test/config/**",
        ],
        css: true,
        server: {
            deps: {
                fallbackCJS: true,
            },
        },
    },
});
