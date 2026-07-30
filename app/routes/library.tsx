import React, { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMode } from "../../utils/ModeContext";
import { MODE_MAP } from "../../utils/mode";
import { useLibraryState } from "../../utils/utils";
import { getGameLibraries } from "../../config/gameLibrary";
import { ClientGameLibrary } from "../../types/types";
import { RocketcrabMode } from "../../types/enums";
import GameLibrary from "../../components/library/GameLibrary";

export const Route = createFileRoute("/library")({
    loader: () => getGameLibraries(),
    component: LibraryComponent,
});

function LibraryComponent() {
    const mode = useMode();
    const navigate = useNavigate();
    const libraries = Route.useLoaderData();

    const gameLibrary: ClientGameLibrary =
        libraries[mode as RocketcrabMode] || libraries[RocketcrabMode.MAIN];

    const onDone = useCallback(() => {
        navigate({ to: "/" });
    }, [navigate]);

    const onViewGame = useCallback(
        (gameId: string) => {
            navigate({ to: `/game/${gameId}` });
        },
        [navigate],
    );

    const libraryState = useLibraryState();

    return (
        <div>
            <GameLibrary
                gameLibrary={gameLibrary}
                backToLabel={MODE_MAP[mode]}
                onDone={onDone}
                setViewingGameId={onViewGame}
                libraryState={libraryState}
            />
        </div>
    );
}
