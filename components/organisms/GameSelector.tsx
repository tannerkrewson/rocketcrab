import CategoryGroup from "../molecules/CategoryGroup";
import { Input, useInput, Spacer } from "@zeit-ui/react";
import GameGroup from "../molecules/GameGroup";
import { useState, useEffect } from "react";
import { ClientGameLibrary } from "../../types/types";
import PrimaryButton from "../atoms/PrimaryButton";

const GameSelector = ({
    gameLibrary,
    onSelectGame,
    onDone,
    backToLabel,
}: GameSelectorProps): JSX.Element => {
    const { state: search, setState: setSearch, bindings } = useInput("");
    const [selectedCategory, setSelectedCategory] = useState("");

    useEffect(() => {
        if (!search) setSelectedCategory("");
    }, [search]);

    const fullCategory = gameLibrary.categories.find(
        ({ id }) => id === selectedCategory
    );

    const categoryName = fullCategory ? fullCategory.name + " " : "";

    return (
        <>
            <div>{categoryName}Games</div>
            <Spacer y={1} />
            {!selectedCategory && (
                <>
                    <Input
                        icon="🔎"
                        placeholder="Search"
                        width="100%"
                        clearable
                        {...bindings}
                    />
                    <Spacer y={1} />
                </>
            )}
            {!selectedCategory && !search && (
                <>
                    <CategoryGroup
                        categories={gameLibrary.categories}
                        onSelectCategory={setSelectedCategory}
                    />
                    <Spacer y={1} />
                    <PrimaryButton onClick={onDone} size="medium">
                        ↩️ Back to {backToLabel}
                    </PrimaryButton>
                </>
            )}
            {(selectedCategory || search) && (
                <>
                    <GameGroup
                        gameList={gameLibrary.gameList}
                        onSelectGame={(game) => {
                            onSelectGame(game);
                            onDone();
                        }}
                        nameFilter={search}
                        categoryFilter={selectedCategory}
                    />
                    <Spacer y={1} />
                    <PrimaryButton
                        onClick={() => {
                            setSelectedCategory("");
                            setSearch("");
                        }}
                    >
                        ↩️ Back to categories
                    </PrimaryButton>
                </>
            )}
        </>
    );
};

type GameSelectorProps = {
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameName: string) => void;
    onDone: () => void;
    backToLabel: string;
};

export default GameSelector;
