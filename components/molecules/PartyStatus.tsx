import { Card } from "@geist-ui/react";
import { JellyfishSpinner } from "react-spinners-kit";
import { ClientGame } from "../../types/types";

const PartyStatus = ({ selectedGame }: PartyStatusProps): JSX.Element => (
    <Card
        style={{
            border: "1pt solid #ddd",
            borderRadius: "0",
        }}
    >
        <JellyfishSpinner />
        <span>
            {selectedGame
                ? selectedGame.name + " selected! Waiting for host to start..."
                : "Waiting for host to select a game..."}
        </span>
    </Card>
);

type PartyStatusProps = {
    selectedGame: ClientGame;
};

export default PartyStatus;
