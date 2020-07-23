import NameBox from "../atoms/NameBox";
import { Grid } from "@zeit-ui/react";
import { Player } from "../../types/types";

const PlayerList = ({ playerList }: PlayerListProps): JSX.Element => (
    <Grid.Container gap={1}>
        {playerList.map(({ name }, i) => (
            <Grid xs={12} key={i}>
                <NameBox name={name} key={i} />
            </Grid>
        ))}
    </Grid.Container>
);

type PlayerListProps = {
    playerList: Array<Player>;
};

export default PlayerList;
