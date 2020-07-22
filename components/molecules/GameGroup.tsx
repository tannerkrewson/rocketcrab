import { Grid } from "@zeit-ui/react";
import { ClientGame } from "../../types/types";
import GameBox from "../atoms/GameBox";

const GameGroup = ({
    gameList,
    nameFilter,
    categoryFilter,
    onSelectGame,
}: GameGroupProps): JSX.Element => (
    <Grid.Container gap={1} style={{ maxWidth: "18em", margin: "0 auto" }}>
        {gameList
            .filter(
                ({ category }) =>
                    !categoryFilter || category.includes(categoryFilter)
            )
            .filter(({ name }) =>
                name.toLowerCase().includes(nameFilter.toLowerCase().trim())
            )
            .map((game, i) => (
                <Grid xs={24} key={i}>
                    <GameBox game={game} onClick={onSelectGame} />
                </Grid>
            ))}
    </Grid.Container>
);

type GameGroupProps = {
    gameList: Array<ClientGame>;
    nameFilter: string;
    categoryFilter: string;
    onSelectGame: (name: string) => void;
};

export default GameGroup;
