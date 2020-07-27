import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@zeit-ui/react";
import GameSelector from "./GameSelector";
import GameBox from "../atoms/GameBox";
import { Player, ClientGameLibrary } from "../../types/types";
import { useState } from "react";
import NameBox from "../atoms/NameBox";

const Lobby = ({
    playerList,
    gameLibrary,
    onSelectGame,
    selectedGame,
    onStartGame,
    resetName,
    meId,
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
                />
            ) : (
                <>
                    <Spacer y={2} />
                    {selectedGame ? (
                        <GameBox
                            game={gameLibrary.gameList.find(
                                ({ name }) => name === selectedGame
                            )}
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
                            disabled={!selectedGame}
                            onClick={onStartGame}
                            size="large"
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
                    <PrimaryButton href="/" size="small" type="error">
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
    onSelectGame: (gameName: string) => void;
    selectedGame: string;
    onStartGame: () => void;
    resetName: () => void;
    meId: number;
};

export default Lobby;
