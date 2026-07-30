import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
    plugins: [
        tailwindcss(),
        tanstackStart({
            srcDirectory: "app",
        }),
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: [
                "favicon.ico",
                "apple-touch-icon.png",
                "maskable-192x192.png",
                "maskable-256x256.png",
                "maskable-384x384.png",
                "maskable-512x512.png",
                "android-chrome-192x192.png",
                "android-chrome-512x512.png",
            ],
            manifest: {
                name: "rocketcrab",
                short_name: "rocketcrab",
                description: "party games for phones",
                theme_color: "#ffffff",
                background_color: "#ffffff",
                display: "standalone",
                start_url: "/",
                icons: [
                    {
                        src: "/maskable-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                        purpose: "maskable",
                    },
                    {
                        src: "/maskable-256x256.png",
                        sizes: "256x256",
                        type: "image/png",
                        purpose: "maskable",
                    },
                    {
                        src: "/maskable-384x384.png",
                        sizes: "384x384",
                        type: "image/png",
                        purpose: "maskable",
                    },
                    {
                        src: "/maskable-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "maskable",
                    },
                    {
                        src: "/android-chrome-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                        purpose: "any",
                    },
                    {
                        src: "/android-chrome-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "any",
                    },
                ],
            },
            workbox: {
                globPatterns: [
                    "**/*.{js,css,html,woff2,png,svg,ico,webmanifest}",
                ],
                navigateFallback: "/",
                navigateFallbackDenylist: [
                    /^\/api\//,
                    /^\/transfer\//,
                    /^\/socket\.io\//,
                ],
                runtimeCaching: [
                    {
                        urlPattern: /^https?:\/\/.*/i,
                        handler: "NetworkFirst",
                        options: {
                            cacheName: "external-resources",
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 60 * 60 * 24,
                            },
                        },
                    },
                ],
            },
        }),
    ],
    server: {
        port: 3001,
    },
});
