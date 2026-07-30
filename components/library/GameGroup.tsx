import PrimaryButton from "../common/PrimaryButton";
import GameBox from "./GameBox";
import { ClientGame } from "../../types/types";

const GameGroup = ({
    games,
    onBack,
    onSelectGame,
    errorMessage,
}: GameGroupProps): JSX.Element => (
    <>
        <div className="my-4 gap-2 grid grid-cols-1">
            {games && games.length ? (
                games.map((game) => (
                    <GameBox key={game.id} game={game} onClick={onSelectGame} />
                ))
            ) : (
                <div>{errorMessage}</div>
            )}
        </div>
        <div className="h-24"></div>
        <PrimaryButton onClick={onBack}>↩️ Back to categories</PrimaryButton>
    </>
);

type GameGroupProps = {
    games: Array<ClientGame>;
    onSelectGame: (id: string) => void;
    onBack: () => void;
    errorMessage: string;
};

export default GameGroup;
