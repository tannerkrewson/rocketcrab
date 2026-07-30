import CategoryGroup from "./CategoryGroup";
import { Input } from "@heroui/react";
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
    const { selectedCategory, setSelectedCategory, search, setSearch } =
        libraryState;

    const fullCategory = gameLibrary?.categories?.find(
        ({ id }) => id === selectedCategory,
    );

    const categoryName = fullCategory ? fullCategory.name + " " : "";

    const showRecentGames = selectedCategory === "recent";

    return (
        <div style={{ textAlign: "center", justifyContent: "center" }}>
            <div className="h-8"></div>
            <h4>{categoryName}Games</h4>
            <div className="h-4"></div>
            {!selectedCategory && (
                <SearchBox search={search} onSearchChange={setSearch} />
            )}
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

const SearchBox = ({ search, onSearchChange }) => (
    <>
        <Input
            size="lg"
            placeholder="Search"
            width="100%"
            value={search}
            onValueChange={onSearchChange}
        />
        <div className="h-4"></div>
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
