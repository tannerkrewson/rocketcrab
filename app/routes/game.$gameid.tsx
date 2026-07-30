import React from "react";
import {
    createFileRoute,
    useParams,
    useNavigate,
} from "@tanstack/react-router";
import { useMode } from "../../utils/ModeContext";
import { GAME_LIBRARY } from "../../config";
import { ClientGame, ClientGameLibrary } from "../../types/types";
import { RocketcrabMode } from "../../types/enums";
import GameDetail from "../../components/detail/GameDetail";
import PrimaryButton from "../../components/common/PrimaryButton";
import PageLayout from "../../components/layout/PageLayout";

export const Route = createFileRoute("/game/$gameid")({
    component: GameDetailComponent,
    notFoundComponent: () => (
        <PageLayout mode={"MAIN" as RocketcrabMode}>
            <div className="text-center py-12">
                <h1 className="text-2xl font-bold mb-4">Game Not Found</h1>
                <p className="mb-4">
                    The game you're looking for doesn't exist or isn't available
                    in this mode.
                </p>
                <PrimaryButton href="/library">Browse Games</PrimaryButton>
            </div>
        </PageLayout>
    ),
});

function GameDetailComponent() {
    const { gameid } = useParams({ from: "/game/$gameid" });
    const mode = useMode();
    const navigate = useNavigate();

    const gameLibrary: ClientGameLibrary =
        GAME_LIBRARY[mode as RocketcrabMode] ||
        GAME_LIBRARY[RocketcrabMode.MAIN];

    const game: ClientGame | undefined = gameLibrary.gameList.find(
        ({ id }) => id === gameid,
    );

    if (!game) {
        return (
            <PageLayout mode={mode}>
                <div className="text-center py-12">
                    <h1 className="text-2xl font-bold mb-4">Game Not Found</h1>
                    <p className="mb-4">
                        The game you're looking for doesn't exist or isn't
                        available in this mode.
                    </p>
                    <PrimaryButton href="/library">Browse Games</PrimaryButton>
                </div>
            </PageLayout>
        );
    }

    const onBack = () => navigate({ to: "/library" });

    return (
        <PageLayout mode={mode}>
            <GameDetail game={game} allCategories={gameLibrary.categories} />
            <div className="flex justify-center space-x-2">
                <PrimaryButton onClick={onBack}>
                    ↩️ Back to search
                </PrimaryButton>
                <PrimaryButton href={`/transfer/${game.id}/`}>
                    Start Party
                </PrimaryButton>
            </div>
        </PageLayout>
    );
}
