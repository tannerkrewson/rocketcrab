import NameBox from "../atoms/NameBox";
import { Grid } from "@geist-ui/react";
import { Player } from "../../types/types";

const PlayerList = ({
    playerList,
    onEditName,
    meId,
}: PlayerListProps): JSX.Element => (
    <Grid.Container gap={1}>
        {playerList.map(({ id, name, isHost }) => (
            <Grid xs={12} key={id}>
                <NameBox
                    name={name}
                    label={[
                        ...(meId === id ? ["You"] : []),
                        ...(isHost ? ["Host"] : []),
                    ]}
                    color={isHost ? "#e00" : undefined}
                    onEditName={meId === id ? onEditName : undefined}
                />
            </Grid>
        ))}
    </Grid.Container>
);

type PlayerListProps = {
    playerList: Array<Player>;
    onEditName?: () => void;
    meId?: number;
};

export default PlayerList;
