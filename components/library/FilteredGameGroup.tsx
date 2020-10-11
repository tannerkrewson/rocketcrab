import { ClientGame } from "../../types/types";
import GameBox from "./GameBox";
import GameGroup from "./GameGroup";

const FilteredGameGroup = ({
    gameList,
    nameFilter,
    categoryFilter,
    onSelectGame,
    onBack,
}: FilteredGameGroupProps): JSX.Element => {
    const games = gameList
        .filter(
            ({ category }) =>
                !categoryFilter || category.includes(categoryFilter)
        )
        .filter(({ name, author }) =>
            (name + author)
                .toLowerCase()
                .includes(nameFilter.toLowerCase().trim())
        )
        .map((game, i) => (
            <GameBox
                key={game.id}
                count={i}
                game={game}
                onClick={onSelectGame}
            />
        ));

    if (!games.length) {
        return <div>No games found 😭</div>;
    }

    return <GameGroup games={games} onBack={onBack} />;
};

type FilteredGameGroupProps = {
    gameList: Array<ClientGame>;
    nameFilter: string;
    categoryFilter: string;
    onSelectGame: (id: string) => void;
    onBack: () => void;
};

export default FilteredGameGroup;
