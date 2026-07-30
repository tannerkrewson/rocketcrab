import { useCallback, useState } from "react";
import { ClientGameLibrary } from "../../types/types";
import PrimaryButton from "../common/PrimaryButton";
import GameDetail from "../detail/GameDetail";
import GameLibrary from "./GameLibrary";
import { useLibraryState } from "../../utils/utils";

const GameSelector = ({
    gameLibrary,
    onSelectGame,
    onDone,
    onSuggestGame,
    backToLabel,
    isHost,
}: GameSelectorProps): JSX.Element => {
    const [viewingGameId, setViewingGameId] = useState("");
    const viewingGame = gameLibrary.gameList.find(
        ({ id }) => id === viewingGameId,
    );

    const onBackToSearch = useCallback(() => {
        setViewingGameId("");
    }, [setViewingGameId]);

    const onSelectGameButton = useCallback(() => {
        if (isHost) {
            onSelectGame(viewingGameId, viewingGame.name);
        } else {
            onSuggestGame(viewingGame.name);
        }

        onDone();
    }, [
        isHost,
        onDone,
        onSelectGame,
        viewingGameId,
        viewingGame,
        onSuggestGame,
    ]);

    const libraryState = useLibraryState();

    return (
        <>
            {!viewingGameId && (
                <GameLibrary
                    gameLibrary={gameLibrary}
                    onDone={onDone}
                    backToLabel={backToLabel}
                    setViewingGameId={setViewingGameId}
                    libraryState={libraryState}
                />
            )}
            {viewingGameId && (
                <>
                    <GameDetail
                        game={viewingGame}
                        allCategories={gameLibrary.categories}
                        showOnlyHostMessage={!isHost}
                    />
                    <div className="h-4"></div>
                    <div className="flex justify-center space-x-2">
                        <PrimaryButton onClick={onBackToSearch}>
                            ↩️ Back to search
                        </PrimaryButton>
                        <PrimaryButton
                            onClick={onSelectGameButton}
                            color={isHost ? "danger" : "default"}
                        >
                            {isHost ? "Select" : "Suggest"} game
                        </PrimaryButton>
                    </div>
                </>
            )}
        </>
    );
};

type GameSelectorProps = {
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameId: string, gameName?: string) => void;
    onDone: () => void;
    onSuggestGame?: (gameName: string) => void;
    backToLabel: string;
    isHost: boolean;
};

export default GameSelector;
