import PlayerList from "../molecules/PlayerList";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";
import { Spacer } from "@zeit-ui/react";

const Lobby = ({ playerList }) => (
    <div style={{ textAlign: "center" }}>
        <div>Players</div>
        <PlayerList playerList={playerList} />
        <Spacer y={1} />
        <ButtonGroup>
            <PrimaryButton href="/">Leave Lobby</PrimaryButton>
            <PrimaryButton disabled>Start Game</PrimaryButton>
        </ButtonGroup>
    </div>
);

export default Lobby;
