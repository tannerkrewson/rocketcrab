import CategoryGroup from "../molecules/CategoryGroup";
import { Input, useInput } from "@zeit-ui/react";
import GameGroup from "../molecules/GameGroup";
import { useState, useEffect } from "react";

const GameSelector = ({ gameLibrary, onGameSelect }) => {
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
                    onSelectGame={(game) => {
                        onGameSelect(game);
                    }}
                    nameFilter={search}
                    categoryFilter={selectedCategory}
                />
            )}
        </>
    );
};

export default GameSelector;
