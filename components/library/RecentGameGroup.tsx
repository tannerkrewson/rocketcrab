import { useEffect, useState } from "react";
import { ClientGame } from "../../types/types";
import { RocketcrabDexie } from "../../utils/dexie";
import GameGroup from "./GameGroup";

const RecentGameGroup = ({
    gameList,
    onSelectGame,
    onBack,
}: RecentGameGroupProps): JSX.Element => {
    const [games, setGames] = useState<Array<ClientGame> | undefined>();

    useEffect(() => {
        const getRecentGames = async () => {
            const { recentGames } = new RocketcrabDexie();

            const sortedRecentGames = await recentGames
                .orderBy("date")
                .reverse()
                .toArray();

            setGames(
                gameList.filter(({ id }) =>
                    sortedRecentGames.find(({ gameId }) => id === gameId)
                )
            );
        };
        getRecentGames();
    }, []);

    return (
        <GameGroup
            games={games}
            onSelectGame={onSelectGame}
            onBack={onBack}
            errorMessage={`You haven't play any games yet! You should change that! 😊`}
        />
    );
};

type RecentGameGroupProps = {
    gameList: Array<ClientGame>;
    onSelectGame: (id: string) => void;
    onBack: () => void;
};

export default RecentGameGroup;
