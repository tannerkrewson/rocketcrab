import NameBox from "./NameBox";
import { Grid, Spacer } from "@geist-ui/react";
import { Player } from "../../types/types";
import React from "react";
import PrimaryButton from "../common/PrimaryButton";
import SkinnyCard from "../common/SkinnyCard";

const PlayerList = ({
    playerList,
    onEditName,
    meId,
    isPublic,
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
        <Spacer y={1} />
        {playerList.length === 1 && (
            <Grid xs={24}>
                <Spacer y={0.5} />
                <SkinnyCard>
                    When
                    {isPublic ? " others join, " : " your friends join, "}
                    they&apos;ll appear right next to your name!
                    <br />
                    {!isPublic && (
                        <>
                            <Spacer y={0.6} />
                            You have friends... right? 😆 If not, that&apos;s
                            okay, we&apos;ve got you covered:
                            <Spacer y={0.5} />
                            <PrimaryButton href="/find" size="medium">
                                Find Players
                            </PrimaryButton>
                            <Spacer y={0.5} />
                        </>
                    )}
                </SkinnyCard>
            </Grid>
        )}
    </Grid.Container>
);

type PlayerListProps = {
    playerList: Array<Player>;
    onEditName?: () => void;
    meId?: number;
    isPublic: boolean;
};

export default PlayerList;
