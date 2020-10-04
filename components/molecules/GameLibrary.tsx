import CategoryGroup from "../molecules/CategoryGroup";
import { Input, useInput, Spacer } from "@geist-ui/react";
import GameGroup from "../molecules/GameGroup";
import RecentGameGroup from "../molecules/RecentGameGroup";
import { useState, useEffect } from "react";
import { ClientGameLibrary } from "../../types/types";
import PrimaryButton from "../atoms/PrimaryButton";

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
        <div style={{ textAlign: "center" }}>
            <Spacer y={2} />
            <h4>{categoryName}Games</h4>
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
            {(selectedCategory || search) && !showRecentGames && (
                <>
                    <GameGroup
                        gameList={gameLibrary.gameList}
                        onSelectGame={(gameId) => {
                            setViewingGameId(gameId);
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
            {showRecentGames && (
                <>
                    <RecentGameGroup
                        gameList={gameLibrary.gameList}
                        onSelectGame={(gameId) => {
                            setViewingGameId(gameId);
                        }}
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
        </div>
    );
};

type GameLibraryProps = {
    gameLibrary: ClientGameLibrary;
    onDone: () => void;
    backToLabel: string;
    setViewingGameId: (gameId: string) => void;
};

export default GameLibrary;
