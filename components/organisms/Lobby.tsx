import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@zeit-ui/react";
import GameSelector from "../molecules/GameSelector";

const Lobby = ({
    playerList,
    gameList,
    onGameSelect,
    selectedGame,
    onStartGame,
}) => (
    <div style={{ textAlign: "center" }}>
        <div>Players</div>
        <PlayerList playerList={playerList} />
        <Spacer y={1} />
        <div>Games</div>
        <GameSelector
            gameList={gameList}
            onGameSelect={onGameSelect}
            selectedGame={selectedGame}
        />
        <Spacer y={1} />
        <ButtonGroup>
            <PrimaryButton href="/">Leave Lobby</PrimaryButton>
            <PrimaryButton disabled={!selectedGame} onClick={onStartGame}>
                Start Game
            </PrimaryButton>
        </ButtonGroup>
    </div>
);

export default Lobby;
