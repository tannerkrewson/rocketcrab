import { Spacer } from "@geist-ui/react";
import { useCallback, useState } from "react";
import { ClientGameLibrary } from "../../types/types";
import PrimaryButton from "../common/PrimaryButton";
import GameDetail from "../detail/GameDetail";
import ButtonGroup from "../common/ButtonGroup";
import GameLibrary from "./GameLibrary";
import { useLibraryState } from "../../utils/utils";

const GameSelector = ({
    gameLibrary,
    onSelectGame,
    onDone,
    backToLabel,
    isHost,
}: GameSelectorProps): JSX.Element => {
    const [viewingGameId, setViewingGameId] = useState("");
    const viewingGame = gameLibrary.gameList.find(
        ({ id }) => id === viewingGameId
    );

    const onBackToSearch = useCallback(() => {
        setViewingGameId("");
    }, [setViewingGameId]);

    const onSelectGameButton = useCallback(() => {
        onSelectGame(viewingGameId, viewingGame.name);
        onDone();
    }, [onSelectGame, viewingGameId, onDone]);

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
                    <Spacer y={1} />
                    <ButtonGroup>
                        <PrimaryButton onClick={onBackToSearch}>
                            ↩️ Back to search
                        </PrimaryButton>
                        <PrimaryButton
                            disabled={!isHost}
                            onClick={onSelectGameButton}
                            type="error"
                        >
                            Select game
                        </PrimaryButton>
                    </ButtonGroup>
                </>
            )}
        </>
    );
};

type GameSelectorProps = {
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameId: string, gameName?: string) => void;
    onDone: () => void;
    backToLabel: string;
    isHost: boolean;
};

export default GameSelector;
