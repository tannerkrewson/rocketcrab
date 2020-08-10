import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@zeit-ui/react";
import GameSelector from "./GameSelector";
import { Player, ClientGameLibrary } from "../../types/types";
import { useState } from "react";
import NameBox from "../atoms/NameBox";
import GameDetailBox from "../atoms/GameDetailBox";

const Lobby = ({
    playerList,
    gameLibrary,
    onSelectGame,
    selectedGame,
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
                    {selectedGame ? (
                        <GameDetailBox
                            game={gameLibrary.gameList.find(
                                ({ id }) => id === selectedGame
                            )}
                            allCategories={gameLibrary.categories}
                            readyToPlay={true}
                            showOnlyHostMessage={false}
                        />
                    ) : (
                        <NameBox name="No Game Selected" />
                    )}
                    <Spacer y={1} />
                    <ButtonGroup>
                        <PrimaryButton
                            onClick={() => setShowGameSelector(true)}
                            size="large"
                        >
                            View games
                        </PrimaryButton>
                        <PrimaryButton
                            disabled={!selectedGame || !isHost}
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
    selectedGame: string;
    onStartGame: () => void;
    resetName: () => void;
    meId: number;
    isHost: boolean;
};

export default Lobby;
