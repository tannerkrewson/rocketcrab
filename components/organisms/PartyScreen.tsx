import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@geist-ui/react";
import GameSelector from "./GameSelector";
import { Player, ClientGameLibrary } from "../../types/types";
import { useCallback, useState } from "react";
import PartyStatus from "../molecules/PartyStatus";

const PartyScreen = ({
    playerList,
    gameLibrary,
    onSelectGame,
    selectedGameId,
    onStartGame,
    resetName,
    meId,
    isHost,
    onInOutParty,
}: PartyScreenProps): JSX.Element => {
    const [gameSelectorVisible, setGameSelectorVisible] = useState(false);

    const showGameSelector = useCallback(() => {
        onInOutParty(true);
        setGameSelectorVisible(true);
    }, [onInOutParty, setGameSelectorVisible]);

    const hideGameSelector = useCallback(() => {
        onInOutParty(false);
        setGameSelectorVisible(false);
    }, [onInOutParty, setGameSelectorVisible]);

    return (
        <div style={{ textAlign: "center" }}>
            {gameSelectorVisible ? (
                <GameSelector
                    gameLibrary={gameLibrary}
                    onSelectGame={onSelectGame}
                    onDone={hideGameSelector}
                    backToLabel="party"
                    isHost={isHost}
                />
            ) : (
                <>
                    <Spacer y={1.25} />
                    <PartyStatus
                        selectedGame={gameLibrary.gameList.find(
                            ({ id }) => id === selectedGameId
                        )}
                    />
                    <Spacer y={1} />
                    <ButtonGroup>
                        <PrimaryButton onClick={showGameSelector} size="large">
                            View games
                        </PrimaryButton>
                        <PrimaryButton
                            disabled={!selectedGameId || !isHost}
                            onClick={onStartGame}
                            size="large"
                            type="error"
                        >
                            Start Game
                        </PrimaryButton>
                    </ButtonGroup>
                    <Spacer y={2} />
                    <PlayerList
                        playerList={playerList}
                        onEditName={resetName}
                        meId={meId}
                    />
                    <Spacer y={1} />
                    <PrimaryButton href="/" size="small">
                        Leave Party
                    </PrimaryButton>
                </>
            )}
        </div>
    );
};

type PartyScreenProps = {
    playerList: Array<Player>;
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameId: string) => void;
    selectedGameId: string;
    onStartGame: () => void;
    resetName: () => void;
    meId: number;
    isHost: boolean;
    onInOutParty: (outOfParty: boolean) => void;
};

export default PartyScreen;
