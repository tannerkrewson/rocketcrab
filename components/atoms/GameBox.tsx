import { ClientGame } from "../../types/types";
import { Card } from "@zeit-ui/react";

const GameBox = ({ game, onClick }: GameBoxProps): JSX.Element => (
    <Card
        onClick={() => onClick && onClick(game.name)}
        style={{ cursor: onClick ? "pointer" : "default", userSelect: "none" }}
    >
        <Card.Body style={{ padding: "8pt", textAlign: "initial" }}>
            <b>{game.name}</b>
            &nbsp;by {game.author}
        </Card.Body>
    </Card>
);

type GameBoxProps = {
    game: ClientGame;
    onClick?: (name: string) => void;
};

export default GameBox;
