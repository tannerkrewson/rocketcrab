import { Card, CardBody } from "@heroui/react";
import { ClientGame } from "../../types/types";

const GameBox = ({ game, onClick }: GameBoxProps): JSX.Element => {
    return (
        <Card
            isPressable
            onPress={() => onClick(game.id)}
            className="relative"
        >
            <CardBody className="text-left p-4">
                <b>{game.name}</b>
                <div className="text-default-500">{"by " + game.author}</div>
                <span className="absolute bottom-4 right-4">➡️</span>
            </CardBody>
        </Card>
    );
};

type GameBoxProps = {
    game: ClientGame;
    onClick: (name: string) => void;
};

export default GameBox;
