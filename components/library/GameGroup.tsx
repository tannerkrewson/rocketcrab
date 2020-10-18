import { Grid, Spacer } from "@geist-ui/react";
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
    <Grid.Container gap={1}>
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
    </Grid.Container>
);

type GameGroupProps = {
    games: Array<ClientGame>;
    onSelectGame: (id: string) => void;
    onBack: () => void;
    errorMessage: string;
};

export default GameGroup;
