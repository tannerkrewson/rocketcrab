import React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
    component: IndexComponent,
    loader: () => {
        return {
            title: "Rocketcrab",
            message: "TanStack Start is working! 🚀",
        };
    },
    meta: () => [
        {
            title: "Rocketcrab",
        },
    ],
});

function IndexComponent() {
    const data = Route.useLoaderData();

    return (
        <div style={{ textAlign: "center", padding: "2em" }}>
            <h1>{data.title}</h1>
            <p>{data.message}</p>
            <div style={{ marginTop: "2em" }}>
                <p>
                    <Link to="/">Home</Link>
                </p>
                <p>
                    <a href="/api/stats">API Stats</a>
                </p>
                <p>
                    <span>Socket.IO: </span>
                    <span id="socket-status">checking...</span>
                </p>
            </div>
        </div>
    );
}
