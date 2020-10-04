import { Grid } from "@geist-ui/react";
import { useEffect, useState } from "react";
import { ClientGame } from "../../types/types";
import { RocketcrabDexie } from "../../utils/dexie";
import GameBox from "../atoms/GameBox";

const RecentGameGroup = ({
    gameList,
    onSelectGame,
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
                        <Grid xs={24} key={i}>
                            <GameBox game={game} onClick={onSelectGame} />
                        </Grid>
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

    return <Grid.Container gap={1}>{games}</Grid.Container>;
};

type RecentGameGroupProps = {
    gameList: Array<ClientGame>;
    onSelectGame: (id: string) => void;
};

export default RecentGameGroup;
