import React from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
    component: RootComponent,
    notFoundComponent: () => (
        <div style={{ textAlign: "center", padding: "2em" }}>
            <h1>404 — Page Not Found</h1>
            <p>This page does not exist.</p>
            <a href="/">Go home</a>
        </div>
    ),
});

function RootComponent() {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
            </head>
            <body>
                <Outlet />
            </body>
        </html>
    );
}
