import { Grid } from "@geist-ui/react";
import { ClientGame } from "../../types/types";
import GameBox from "../atoms/GameBox";

const GameGroup = ({
    gameList,
    nameFilter,
    categoryFilter,
    onSelectGame,
}: GameGroupProps): JSX.Element => {
    const games = gameList
        .filter(
            ({ category }) =>
                !categoryFilter || category.includes(categoryFilter)
        )
        .filter(({ name, author }) =>
            (name + author)
                .toLowerCase()
                .includes(nameFilter.toLowerCase().trim())
        )
        .map((game, i) => (
            <Grid xs={24} key={i}>
                <div className="anim-box">
                    <GameBox game={game} onClick={onSelectGame} />
                </div>
                <style jsx>{`
                    .anim-box {
                        animation-name: fadein;
                        animation-duration: 0.25s;
                        animation-timing-function: ease-in-out;
                        animation-delay: ${i * 0.05}s;
                        animation-fill-mode: both;
                    }
                    @keyframes fadein {
                        from {
                            opacity: 0;
                            visibility: hidden;
                            transform: translateX(10%);
                        }
                        to {
                            opacity: 1;
                            visibility: visible;
                            transform: translateX(0%);
                        }
                    }
                `}</style>
            </Grid>
        ));

    if (!games.length) {
        return <div>No games found 😭</div>;
    }

    return <Grid.Container gap={1}>{games}</Grid.Container>;
};

type GameGroupProps = {
    gameList: Array<ClientGame>;
    nameFilter: string;
    categoryFilter: string;
    onSelectGame: (id: string) => void;
};

export default GameGroup;
