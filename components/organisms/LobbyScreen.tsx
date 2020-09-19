import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@geist-ui/react";
import GameSelector from "./GameSelector";
import { Player, ClientGameLibrary } from "../../types/types";
import { useCallback, useState } from "react";
import LobbyStatus from "../molecules/LobbyStatus";

const Lobby = ({
    playerList,
    gameLibrary,
    onSelectGame,
    selectedGameId,
    onStartGame,
    resetName,
    meId,
    isHost,
    onInOutLobby,
}: LobbyProps): JSX.Element => {
    const [gameSelectorVisible, setGameSelectorVisible] = useState(false);

    const showGameSelector = useCallback(() => {
        onInOutLobby(true);
        setGameSelectorVisible(true);
    }, [onInOutLobby, setGameSelectorVisible]);

    const hideGameSelector = useCallback(() => {
        onInOutLobby(false);
        setGameSelectorVisible(false);
    }, [onInOutLobby, setGameSelectorVisible]);

    return (
        <div style={{ textAlign: "center" }}>
            {gameSelectorVisible ? (
                <GameSelector
                    gameLibrary={gameLibrary}
                    onSelectGame={onSelectGame}
                    onDone={hideGameSelector}
                    backToLabel="lobby"
                    isHost={isHost}
                />
            ) : (
                <>
                    <Spacer y={1.25} />
                    <LobbyStatus
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
                        Leave Lobby
                    </PrimaryButton>
                </>
            )}
        </div>
    );
};

type LobbyProps = {
    playerList: Array<Player>;
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameId: string) => void;
    selectedGameId: string;
    onStartGame: () => void;
    resetName: () => void;
    meId: number;
    isHost: boolean;
    onInOutLobby: (outOfLobby: boolean) => void;
};

export default Lobby;
