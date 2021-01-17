import { Spacer } from "@geist-ui/react";
import React from "react";
import SkinnyCard from "../common/SkinnyCard";
import { Countdown } from "./Countdown";
import FindTime from "./FindTime";

export const FinderInfoCard = ({
    subscriberCount,
    subscriberCountMsg,
    showCountdown,
    countdownStart,
    countdownMsg,
    findTimeDates,
}: {
    subscriberCount: number;
    subscriberCountMsg: string;
    showCountdown: boolean;
    countdownStart: number;
    countdownMsg: string;
    findTimeDates?: number[];
}): JSX.Element => {
    const showSubscriberCount = subscriberCount > 0;
    const scs = subscriberCount === 1;
    if (!showSubscriberCount && !showCountdown) return <Spacer y={1} />;
    return (
        <>
            <Spacer y={1} />
            <SkinnyCard>
                {showSubscriberCount && (
                    <div style={{ textAlign: "center" }}>
                        There {scs ? "is " : "are "}
                        {subscriberCount} other
                        {scs ? " person " : " people "}
                        {subscriberCountMsg}
                    </div>
                )}
                {showSubscriberCount && showCountdown && <Spacer y={0.8} />}
                {showCountdown && (
                    <Countdown start={countdownStart}>{countdownMsg}</Countdown>
                )}
                {showCountdown && findTimeDates && <Spacer y={0.2} />}
                {findTimeDates && <FindTime dates={findTimeDates} />}
            </SkinnyCard>
            <Spacer y={1} />
        </>
    );
};
