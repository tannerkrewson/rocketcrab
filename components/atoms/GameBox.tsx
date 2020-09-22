import { ClientGame } from "../../types/types";
import { Card, Description } from "@geist-ui/react";

const GameBox = ({ game, onClick }: GameBoxProps): JSX.Element => (
    <Card
        onClick={() => onClick && onClick(game.id)}
        style={{
            cursor: onClick ? "pointer" : "default",
            userSelect: "none",
            border: "1px solid #ddd",
            borderRadius: "0",
        }}
    >
        <Card.Body
            style={{
                padding: "8pt",
                textAlign: "initial",
                position: "relative",
            }}
        >
            <b>{game.name}</b>
            <Description
                style={{ width: "fit-content" }}
                title={"by " + game.author}
            />
            {onClick && (
                <span
                    style={{
                        position: "absolute",
                        right: ".5em",
                        top: "1.2em",
                    }}
                >
                    ➡️
                </span>
            )}
        </Card.Body>
    </Card>
);

type GameBoxProps = {
    game: ClientGame;
    onClick?: (name: string) => void;
};

export default GameBox;
