import CategoryGroup from "../molecules/CategoryGroup";
import { Input, useInput, Spacer } from "@zeit-ui/react";
import GameGroup from "../molecules/GameGroup";
import { useState, useEffect } from "react";
import { ClientGameLibrary } from "../../types/types";
import PrimaryButton from "../atoms/PrimaryButton";
import GameDetailBox from "../atoms/GameDetailBox";
import ButtonGroup from "../molecules/ButtonGroup";

const GameSelector = ({
    gameLibrary,
    onSelectGame,
    onDone,
    backToLabel,
    isHost,
}: GameSelectorProps): JSX.Element => {
    const { state: search, setState: setSearch, bindings } = useInput("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [viewingGameId, setViewingGameId] = useState("");

    useEffect(() => {
        if (!search) setSelectedCategory("");
    }, [search]);

    const fullCategory = gameLibrary.categories.find(
        ({ id }) => id === selectedCategory
    );

    const categoryName = fullCategory ? fullCategory.name + " " : "";

    return (
        <>
            {!viewingGameId && (
                <>
                    <div>{categoryName}Games</div>
                    <Spacer y={1} />
                </>
            )}
            {!selectedCategory && !viewingGameId && (
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
            {!selectedCategory && !search && !viewingGameId && (
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
            {(selectedCategory || search) && !viewingGameId && (
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
            {viewingGameId && (
                <>
                    <GameDetailBox
                        game={gameLibrary.gameList.find(
                            ({ id }) => id === viewingGameId
                        )}
                        allCategories={gameLibrary.categories}
                        showOnlyHostMessage={!isHost}
                    />
                    <Spacer y={1} />
                    <ButtonGroup>
                        <PrimaryButton
                            onClick={() => {
                                setViewingGameId("");
                            }}
                        >
                            ↩️ Back to search
                        </PrimaryButton>
                        {isHost && (
                            <PrimaryButton
                                onClick={() => {
                                    onSelectGame(viewingGameId);
                                    onDone();
                                }}
                            >
                                Select Game
                            </PrimaryButton>
                        )}
                    </ButtonGroup>
                </>
            )}
        </>
    );
};

type GameSelectorProps = {
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameId: string) => void;
    onDone: () => void;
    backToLabel: string;
    isHost: boolean;
};

export default GameSelector;
