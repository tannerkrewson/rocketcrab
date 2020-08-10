import { Grid } from "@zeit-ui/react";
import { ClientGame } from "../../types/types";
import GameBox from "../atoms/GameBox";

const GameGroup = ({
    gameList,
    nameFilter,
    categoryFilter,
    onSelectGame,
}: GameGroupProps): JSX.Element => {
    const games = gameList
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
        ));

    if (!games.length) {
        return <div>No games found 😭</div>;
    }

    return <Grid.Container gap={1}>{games}</Grid.Container>;
};

type GameGroupProps = {
    gameList: Array<ClientGame>;
    nameFilter: string;
    categoryFilter: string;
    onSelectGame: (id: string) => void;
};

export default GameGroup;
