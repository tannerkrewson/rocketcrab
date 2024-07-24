import NameBox from "./NameBox";
import { Spacer } from "@nextui-org/react";
import { Player } from "../../types/types";
import React from "react";
import { CollapseBox } from "../common/CollapseBox";

const PlayerList = ({
    playerList,
    onEditName,
    meId,
    startHidden,
    disableHideShow,
    onKick,
    disableEditName = false,
}: PlayerListProps): JSX.Element => {
    const meIsHost = playerList.find(({ id }) => meId === id)?.isHost;
    const isMe = (id) => meId === id;

    return (
        <CollapseBox
            title="Players"
            startHidden={startHidden}
            disableHideShow={disableHideShow}
            badgeCount={playerList.length}
            badgeType="secondary"
            onlyShowBadgeWhenCollapsed={false}
        >
            <Spacer y={0.5} />
            {playerList.map(({ id, name, isHost }, index) => (
                <NameBox
                    key={index}
                    name={name}
                    label={[
                        ...(isMe(id) ? ["You"] : []),
                        ...(isHost ? ["Host"] : []),
                    ]}
                    color={isHost && "#e00"}
                    onEditName={!disableEditName && isMe(id) && onEditName}
                    onKick={meIsHost && !isMe(id) && (() => onKick(id, name))}
                />
            ))}
        </CollapseBox>
    );
};

type PlayerListProps = {
    playerList: Array<Player>;
    onEditName?: () => void;
    meId?: number;
    startHidden: boolean;
    disableHideShow: boolean;
    onKick: (id: number, name: string) => void;
    disableEditName?: boolean;
};

export default PlayerList;
