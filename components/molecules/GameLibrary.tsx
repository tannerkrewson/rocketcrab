import CategoryGroup from "../molecules/CategoryGroup";
import { Input, useInput, Spacer } from "@geist-ui/react";
import FilteredGameGroup from "./FilteredGameGroup";
import RecentGameGroup from "../molecules/RecentGameGroup";
import { useState, useEffect } from "react";
import { ClientGameLibrary } from "../../types/types";

const GameLibrary = ({
    gameLibrary,
    onDone,
    backToLabel,
    setViewingGameId,
}: GameLibraryProps): JSX.Element => {
    const { state: search, setState: setSearch, bindings } = useInput("");
    const [selectedCategory, setSelectedCategory] = useState("");

    useEffect(() => {
        if (!search) setSelectedCategory("");
    }, [search]);

    const fullCategory = gameLibrary.categories.find(
        ({ id }) => id === selectedCategory
    );

    const categoryName = fullCategory ? fullCategory.name + " " : "";

    const showRecentGames = selectedCategory === "recent";

    return (
        <div style={{ textAlign: "center", justifyContent: "center" }}>
            <Spacer y={2} />
            <h4>{categoryName}Games</h4>
            <Spacer y={1} />
            {!selectedCategory && <SearchBox {...bindings} />}
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
        <Spacer y={1} />
    </>
);

type GameLibraryProps = {
    gameLibrary: ClientGameLibrary;
    onDone: () => void;
    backToLabel: string;
    setViewingGameId: (gameId: string) => void;
};

export default GameLibrary;
