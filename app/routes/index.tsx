import React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMode } from "../../utils/ModeContext";
import { isKidsMode } from "../../utils/mode";

export const Route = createFileRoute("/")({
    component: IndexComponent,
    loader: () => {
        return {
            title: "Rocketcrab",
        };
    },
});

function IndexComponent() {
    const data = Route.useLoaderData();
    const mode = useMode();
    const kids = isKidsMode(mode);

    return (
        <div style={{ textAlign: "center", padding: "2em" }}>
            <h1>{data.title}</h1>
            <p>
                {kids
                    ? "play in class or with family!"
                    : "party games for phones"}
            </p>

            <div style={{ marginTop: "2em" }}>
                <Link to="/join">
                    <button
                        style={{ margin: "0.5em", padding: "0.75em 1.5em" }}
                    >
                        Join Party
                    </button>
                </Link>
                <button
                    style={{ margin: "0.5em", padding: "0.75em 1.5em" }}
                    id="start-party-btn"
                >
                    Start Party
                </button>
            </div>

            <div style={{ marginTop: "2em" }}>
                <Link to="/library">Browse Games</Link>
            </div>

            <div style={{ marginTop: "1em" }}>
                <a href="/api/stats">API Stats</a>
            </div>
        </div>
    );
}
