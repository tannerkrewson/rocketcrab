import { Spacer } from "@nextui-org/react";
import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";
import GameBox from "./GameBox";
import { ClientGame } from "../../types/types";

const GameGroup = ({
    games,
    onBack,
    onSelectGame,
    errorMessage,
}: GameGroupProps): JSX.Element => (
    <>
        {games && games.length ? (
            games.map((game, i) => (
                <GameBox
                    key={game.id}
                    count={i}
                    game={game}
                    onClick={onSelectGame}
                />
            ))
        ) : (
            <div>{errorMessage}</div>
        )}
        <Spacer y={1} />
        <ButtonGroup>
            <PrimaryButton onClick={onBack}>
                ↩️ Back to categories
            </PrimaryButton>
        </ButtonGroup>
    </>
);

type GameGroupProps = {
    games: Array<ClientGame>;
    onSelectGame: (id: string) => void;
    onBack: () => void;
    errorMessage: string;
};

export default GameGroup;
