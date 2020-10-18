import { ClientGame } from "../../types/types";
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
        );

    return (
        <GameGroup
            games={games}
            onSelectGame={onSelectGame}
            onBack={onBack}
            errorMessage="No games found 😭"
        />
    );
};

type FilteredGameGroupProps = {
    gameList: Array<ClientGame>;
    nameFilter: string;
    categoryFilter: string;
    onSelectGame: (id: string) => void;
    onBack: () => void;
};

export default FilteredGameGroup;
