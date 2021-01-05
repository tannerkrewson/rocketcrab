import NameBox from "./NameBox";
import { Grid, Spacer } from "@geist-ui/react";
import { Player } from "../../types/types";
import React from "react";
import { CollapseBox } from "../common/CollapseBox";

const PlayerList = ({
    playerList,
    onEditName,
    meId,
    startHidden,
    disableHideShow,
}: PlayerListProps): JSX.Element => (
    <CollapseBox
        title="Players"
        startHidden={startHidden}
        disableHideShow={disableHideShow}
        badgeCount={0}
    >
        <Spacer y={0.5} />
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
    </CollapseBox>
);

type PlayerListProps = {
    playerList: Array<Player>;
    onEditName?: () => void;
    meId?: number;
    startHidden: boolean;
    disableHideShow: boolean;
};

export default PlayerList;
