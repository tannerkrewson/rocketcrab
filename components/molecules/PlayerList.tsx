import NameBox from "../atoms/NameBox";
import { Grid } from "@zeit-ui/react";

const PlayerList = ({ playerList }) => (
    <Grid.Container gap={1}>
        {playerList.map(({ name }, i) => (
            <Grid xs={12} key={i}>
                <NameBox name={name} key={i} />
            </Grid>
        ))}
    </Grid.Container>
);

export default PlayerList;
