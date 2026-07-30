import { Card } from "@heroui/react";
import { ClientGame } from "../../types/types";

const GameBox = ({ game, onClick }: GameBoxProps): JSX.Element => {
    return (
        <Card
            isHoverable
            onClick={() => onClick(game.id)}
            className="cursor-pointer"
        >
            <div className="text-left mx-4 my-4">
                <b>{game.name}</b>
                <div className="text-gray-400">{"by " + game.author}</div>
            </div>

            <span className="absolute bottom-7 right-4">➡️</span>
        </Card>
    );
};

type GameBoxProps = {
    game: ClientGame;
    onClick: (name: string) => void;
};

export default GameBox;
