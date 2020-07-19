import { ClientGame } from "../../types/types";
import { Card } from "@zeit-ui/react";

const GameBox = ({ game, onClick }: GameBoxProps): JSX.Element => (
    <Card onClick={() => onClick(game.name)}>{game.name}</Card>
);

type GameBoxProps = {
    game: ClientGame;
    onClick: (name: string) => void;
};

export default GameBox;
