import CategoryGroup from "../molecules/CategoryGroup";
import { Input, useInput } from "@zeit-ui/react";
import GameGroup from "../molecules/GameGroup";
import { useState, useEffect } from "react";
import { ClientGameLibrary } from "../../types/types";

const GameSelector = ({
    gameLibrary,
    onSelectGame,
}: GameSelectorProps): JSX.Element => {
    const { state: search, bindings } = useInput("");
    const [selectedCategory, setSelectedCategory] = useState("");

    useEffect(() => {
        if (!search) setSelectedCategory("");
    }, [search]);

    return (
        <>
            {!selectedCategory && (
                <Input
                    icon="🔎"
                    placeholder="Search"
                    width="100%"
                    clearable
                    {...bindings}
                />
            )}
            {selectedCategory && (
                <div onClick={() => setSelectedCategory("")}>
                    ↩️ Back to categories
                </div>
            )}
            {!selectedCategory && !search && (
                <CategoryGroup
                    categories={gameLibrary.categories}
                    onSelectCategory={setSelectedCategory}
                />
            )}
            {(selectedCategory || search) && (
                <GameGroup
                    gameList={gameLibrary.gameList}
                    onSelectGame={onSelectGame}
                    nameFilter={search}
                    categoryFilter={selectedCategory}
                />
            )}
        </>
    );
};

type GameSelectorProps = {
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameName: string) => void;
};

export default GameSelector;
