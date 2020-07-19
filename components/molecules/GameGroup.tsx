import { Grid } from "@zeit-ui/react";
import { ClientGame } from "../../types/types";
import GameBox from "../atoms/GameBox";

const GameGroup = ({ gameList, onSelectGame }: GameGroupProps): JSX.Element => (
    <Grid.Container gap={1} style={{ maxWidth: "18em", margin: "0 auto" }}>
        {gameList.map((game, i) => (
            <Grid xs={12} key={i}>
                <GameBox game={game} onClick={onSelectGame} />
            </Grid>
        ))}
    </Grid.Container>
);

type GameGroupProps = {
    gameList: Array<ClientGame>;
    onSelectGame: (name: string) => void;
};

export default GameGroup;
