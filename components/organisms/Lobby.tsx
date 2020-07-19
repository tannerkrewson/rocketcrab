import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@zeit-ui/react";
import GameSelector from "./GameSelector";

const Lobby = ({
    playerList,
    gameLibrary,
    onGameSelect,
    selectedGame,
    onStartGame,
}) => (
    <div style={{ textAlign: "center" }}>
        <div>Players</div>
        <PlayerList playerList={playerList} />
        <Spacer y={1} />
        <div>Games</div>
        <GameSelector gameLibrary={gameLibrary} onGameSelect={onGameSelect} />
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

export default Lobby;
