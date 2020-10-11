import { Spacer } from "@geist-ui/react";
import { useCallback, useState } from "react";
import { ClientGameLibrary } from "../../types/types";
import PrimaryButton from "../common/PrimaryButton";
import GameDetailBox from "./GameDetailBox";
import ButtonGroup from "../common/ButtonGroup";
import GameLibrary from "./GameLibrary";

const GameSelector = ({
    gameLibrary,
    onSelectGame,
    onDone,
    backToLabel,
    isHost,
}: GameSelectorProps): JSX.Element => {
    const [viewingGameId, setViewingGameId] = useState("");

    const onBackToSearch = useCallback(() => {
        setViewingGameId("");
    }, [setViewingGameId]);

    const onSelectGameButton = useCallback(() => {
        onSelectGame(viewingGameId);
        onDone();
    }, [onSelectGame, viewingGameId, onDone]);

    return (
        <>
            {!viewingGameId && (
                <GameLibrary
                    gameLibrary={gameLibrary}
                    onDone={onDone}
                    backToLabel={backToLabel}
                    setViewingGameId={setViewingGameId}
                />
            )}
            {viewingGameId && (
                <>
                    <GameDetailBox
                        game={gameLibrary.gameList.find(
                            ({ id }) => id === viewingGameId
                        )}
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
                        {isHost && (
                            <PrimaryButton
                                onClick={onSelectGameButton}
                                type="error"
                            >
                                Select Game
                            </PrimaryButton>
                        )}
                    </ButtonGroup>
                </>
            )}
        </>
    );
};

type GameSelectorProps = {
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameId: string) => void;
    onDone: () => void;
    backToLabel: string;
    isHost: boolean;
};

export default GameSelector;
