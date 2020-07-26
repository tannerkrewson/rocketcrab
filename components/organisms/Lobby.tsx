import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@zeit-ui/react";
import GameSelector from "./GameSelector";
import GameBox from "../atoms/GameBox";
import { Player, ClientGameLibrary } from "../../types/types";
import { useState } from "react";

const Lobby = ({
    playerList,
    gameLibrary,
    onSelectGame,
    selectedGame,
    onStartGame,
    resetName,
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
                    {selectedGame ? (
                        <div>
                            Selected game:
                            <GameBox
                                game={gameLibrary.gameList.find(
                                    ({ name }) => name === selectedGame
                                )}
                            />
                        </div>
                    ) : (
                        <div>No Game Selected</div>
                    )}
                    <Spacer y={1} />

                    <div>Players:</div>
                    <PlayerList playerList={playerList} />
                    <Spacer y={1} />

                    <ButtonGroup>
                        <PrimaryButton
                            onClick={() => setShowGameSelector(true)}
                            size="medium"
                        >
                            View games
                        </PrimaryButton>
                        <PrimaryButton onClick={resetName} size="medium">
                            Change my name
                        </PrimaryButton>
                    </ButtonGroup>
                    <Spacer y={1} />

                    <ButtonGroup>
                        <PrimaryButton href="/" size="large">
                            Leave Lobby
                        </PrimaryButton>
                        <PrimaryButton
                            disabled={!selectedGame}
                            onClick={onStartGame}
                            size="large"
                        >
                            Start Game
                        </PrimaryButton>
                    </ButtonGroup>
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
};

export default Lobby;
