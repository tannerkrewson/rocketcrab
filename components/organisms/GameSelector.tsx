import CategoryGroup from "../molecules/CategoryGroup";
import { Input } from "@zeit-ui/react";
import GameGroup from "../molecules/GameGroup";

const GameSelector = ({ gameLibrary, onGameSelect }) => {
    return (
        <>
            <Input
                icon="🔎"
                placeholder="Search"
                width="80%"
                clearable
                style={{ margin: "0 auto" }}
            />
            {true && (
                <CategoryGroup
                    categories={gameLibrary.categories}
                    onSelectCategory={(category) => {
                        // eslint-disable-next-line no-console
                        console.log(category);
                    }}
                />
            )}
            {true && (
                <GameGroup
                    gameList={gameLibrary.gameList}
                    onSelectGame={(game) => {
                        onGameSelect(game);
                    }}
                />
            )}
        </>
    );
};

export default GameSelector;
