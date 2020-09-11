import { Card } from "@zeit-ui/react";
import { JellyfishSpinner } from "react-spinners-kit";
import { ClientGame } from "../../types/types";

const LobbyStatus = ({ selectedGame }: LobbyStatusProps): JSX.Element => (
    <Card>
        <JellyfishSpinner />
        <span>
            {selectedGame
                ? selectedGame.name + " selected! Waiting for host to start..."
                : "Waiting for host to select a game..."}
        </span>
    </Card>
);

type LobbyStatusProps = {
    selectedGame: ClientGame;
};

export default LobbyStatus;
