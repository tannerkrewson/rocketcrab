import { useEffect, useState } from "react";
import { ClientGame } from "../../types/types";
import { RocketcrabDexie } from "../../utils/dexie";
import GameBox from "../atoms/GameBox";
import GameGroup from "./GameGroup";

const RecentGameGroup = ({
    gameList,
    onSelectGame,
    onBack,
}: RecentGameGroupProps): JSX.Element => {
    const [games, setGames] = useState<Array<JSX.Element> | undefined>();

    useEffect(() => {
        const getRecentGames = async () => {
            const { recentGames } = new RocketcrabDexie();

            const sortedRecentGames = await recentGames
                .orderBy("date")
                .reverse()
                .toArray();

            setGames(
                sortedRecentGames
                    .map(({ gameId }) =>
                        gameList.find(({ id }) => id === gameId)
                    )
                    .map((game, i) => (
                        <GameBox
                            key={game.id}
                            count={i}
                            game={game}
                            onClick={onSelectGame}
                        />
                    ))
            );
        };
        getRecentGames();
    }, []);

    if (!games) {
        return <div>Loading...</div>;
    }

    if (!games.length) {
        return (
            <div>
                You haven&apos;t play any games yet! You should change that! 😊
            </div>
        );
    }

    return <GameGroup games={games} onBack={onBack} />;
};

type RecentGameGroupProps = {
    gameList: Array<ClientGame>;
    onSelectGame: (id: string) => void;
    onBack: () => void;
};

export default RecentGameGroup;
