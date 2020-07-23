import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@zeit-ui/react";
import GameSelector from "./GameSelector";
import GameBox from "../atoms/GameBox";
import { Player, ClientGameLibrary } from "../../types/types";

const Lobby = ({
    playerList,
    gameLibrary,
    onSelectGame,
    selectedGame,
    onStartGame,
}: LobbyProps): JSX.Element => (
    <div style={{ textAlign: "center" }}>
        <div>Players</div>
        <PlayerList playerList={playerList} />
        <Spacer y={1} />
        {selectedGame ? (
            <div>
                Selected game:{" "}
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
        <div>Games</div>
        <GameSelector gameLibrary={gameLibrary} onSelectGame={onSelectGame} />
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
    </div>
);

type LobbyProps = {
    playerList: Array<Player>;
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameName: string) => void;
    selectedGame: string;
    onStartGame: () => void;
};

export default Lobby;
