import { ClientGame } from "../../types/types";
import { Card } from "@zeit-ui/react";

const GameBox = ({
    game,
    onClick = () => false,
}: GameBoxProps): JSX.Element => (
    <Card onClick={() => onClick(game.name)}>
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
