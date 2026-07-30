// Rocketcrab Service Worker
// Generated PWA service worker with basic caching strategy.
// For a full Workbox-generated SW, the build integration needs to be
// resolved for the TanStack Start multi-environment Vite build.
// See PWA-01 task for details.

const CACHE_NAME = "rocketcrab-v1";
const ASSET_CACHE = "rocketcrab-assets-v1";
const API_CACHE = "rocketcrab-api-v1";

// Assets to precache on install (updated by build script)
const PRECACHE_URLS = ["/", "/manifest.webmanifest"];

// Install event — precache core assets
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(PRECACHE_URLS);
            })
            .then(() => self.skipWaiting()),
    );
});

// Activate event — clean old caches
self.addEventListener("activate", (event) => {
    const cacheWhitelist = [CACHE_NAME, ASSET_CACHE, API_CACHE];
    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (!cacheWhitelist.includes(cacheName)) {
                            return caches.delete(cacheName);
                        }
                    }),
                );
            })
            .then(() => self.clients.claim()),
    );
});

// Fetch event — cache-first for static assets, network-first for API
self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== "GET") return;

    // Skip Socket.IO and API calls — always network
    if (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/socket.io/") ||
        url.pathname.startsWith("/transfer/")
    ) {
        return;
    }

    // Cache-first for static assets (fonts, images, CSS, JS)
    if (
        url.pathname.startsWith("/assets/") ||
        request.destination === "font" ||
        request.destination === "image" ||
        request.destination === "style" ||
        request.destination === "script"
    ) {
        event.respondWith(
            caches.open(ASSET_CACHE).then((cache) => {
                return cache.match(request).then((cachedResponse) => {
                    const fetchPromise = fetch(request).then(
                        (networkResponse) => {
                            cache.put(request, networkResponse.clone());
                            return networkResponse;
                        },
                    );
                    return cachedResponse || fetchPromise;
                });
            }),
        );
        return;
    }

    // Network-first for navigation requests (SSR pages)
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).catch(() => {
                return caches.match(request).then((cached) => {
                    return cached || caches.match("/");
                });
            }),
        );
        return;
    }
});
