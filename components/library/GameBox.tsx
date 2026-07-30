import { ClientGame } from "../../types/types";

const GameBox = ({ game, onClick }: GameBoxProps): JSX.Element => {
    return (
        <div
            onClick={() => onClick(game.id)}
            className="cursor-pointer rounded-lg border p-4 hover:shadow-md transition-shadow relative"
        >
            <div className="text-left">
                <b>{game.name}</b>
                <div className="text-gray-400">{"by " + game.author}</div>
            </div>

            <span className="absolute bottom-4 right-4">➡️</span>
        </div>
    );
};

type GameBoxProps = {
    game: ClientGame;
    onClick: (name: string) => void;
};

export default GameBox;
