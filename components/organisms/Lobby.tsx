import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@zeit-ui/react";
import GameSelector from "../molecules/GameSelector";

const Lobby = ({ playerList, gameList }) => (
    <div style={{ textAlign: "center" }}>
        <div>Players</div>
        <PlayerList playerList={playerList} />
        <Spacer y={1} />
        <div>Games</div>
        <GameSelector gameList={gameList} />
        <Spacer y={1} />
        <ButtonGroup>
            <PrimaryButton href="/">Leave Lobby</PrimaryButton>
            <PrimaryButton disabled>Start Game</PrimaryButton>
        </ButtonGroup>
    </div>
);

export default Lobby;
