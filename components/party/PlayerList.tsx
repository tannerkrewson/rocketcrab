import NameBox from "./NameBox";

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
            badgeType="default"
            onlyShowBadgeWhenCollapsed={false}
        >
            <div className="h-2"></div>
            <div className="mt-4 mx-2 grid gap-3 grid-cols-2">
                {playerList.map(({ id, name, isHost }, index) => (
                    <NameBox
                        key={index}
                        name={name}
                        label={[
                            ...(isMe(id) ? ["You"] : []),
                            ...(isHost ? ["Host"] : []),
                        ]}
                        isHost={isHost}
                        onEditName={!disableEditName && isMe(id) && onEditName}
                        onKick={
                            meIsHost && !isMe(id) && (() => onKick(id, name))
                        }
                    />
                ))}
            </div>
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
