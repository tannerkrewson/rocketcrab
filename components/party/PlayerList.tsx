import NameBox from "./NameBox";
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
        {playerList.length === 1 && (
            <Grid xs={24}>
                When your friends join, they&apos;ll appear here! <br />
                (You have friends... right? 😆)
            </Grid>
        )}
    </Grid.Container>
);

type PlayerListProps = {
    playerList: Array<Player>;
    onEditName?: () => void;
    meId?: number;
};

export default PlayerList;
