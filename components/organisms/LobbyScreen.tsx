import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@zeit-ui/react";
import GameSelector from "./GameSelector";
import { Player, ClientGameLibrary } from "../../types/types";
import { useState } from "react";
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
}: LobbyProps): JSX.Element => {
    const [showGameSelector, setShowGameSelector] = useState(false);
    return (
        <div style={{ textAlign: "center" }}>
            {showGameSelector ? (
                <GameSelector
                    gameLibrary={gameLibrary}
                    onSelectGame={onSelectGame}
                    onDone={() => setShowGameSelector(false)}
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
                        <PrimaryButton
                            onClick={() => setShowGameSelector(true)}
                            size="large"
                        >
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
};

export default Lobby;
