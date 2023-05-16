import CategoryGroup from "./CategoryGroup";
import { Input, Spacer } from "@geist-ui/react";
import FilteredGameGroup from "./FilteredGameGroup";
import RecentGameGroup from "./RecentGameGroup";
import { ClientGameLibrary, LibraryState } from "../../types/types";

const GameLibrary = ({
    gameLibrary,
    onDone,
    backToLabel,
    setViewingGameId,
    libraryState,
}: GameLibraryProps): JSX.Element => {
    const {
        selectedCategory,
        setSelectedCategory,
        search,
        setSearch,
        searchBindings,
    } = libraryState;

    const fullCategory = gameLibrary?.categories?.find(
        ({ id }) => id === selectedCategory
    );

    const categoryName = fullCategory ? fullCategory.name + " " : "";

    const showRecentGames = selectedCategory === "recent";

    return (
        <div style={{ textAlign: "center", justifyContent: "center" }}>
            <Spacer h={2} />
            <h4>{categoryName}Games</h4>
            <Spacer h={1} />
            {!selectedCategory && <SearchBox {...searchBindings} />}
            {!selectedCategory && !search && (
                <CategoryGroup
                    categories={gameLibrary.categories}
                    onSelectCategory={setSelectedCategory}
                    onDone={onDone}
                    backToLabel={backToLabel}
                />
            )}
            {(selectedCategory || search) && !showRecentGames && (
                <FilteredGameGroup
                    gameList={gameLibrary.gameList}
                    onSelectGame={(gameId) => {
                        setViewingGameId(gameId);
                    }}
                    nameFilter={search}
                    categoryFilter={selectedCategory}
                    onBack={() => {
                        setSelectedCategory("");
                        setSearch("");
                    }}
                />
            )}
            {showRecentGames && (
                <RecentGameGroup
                    gameList={gameLibrary.gameList}
                    onSelectGame={(gameId) => {
                        setViewingGameId(gameId);
                    }}
                    onBack={() => {
                        setSelectedCategory("");
                        setSearch("");
                    }}
                />
            )}
        </div>
    );
};

const SearchBox = (props) => (
    <>
        <Input
            icon="🔎"
            placeholder="Search"
            width="100%"
            clearable
            {...props}
        />
        <Spacer h={1} />
    </>
);

type GameLibraryProps = {
    gameLibrary: ClientGameLibrary;
    onDone: () => void;
    backToLabel: string;
    setViewingGameId: (gameId: string) => void;
    libraryState: LibraryState;
};

export default GameLibrary;
