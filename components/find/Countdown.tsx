import { Spacer } from "@geist-ui/react";
import { formatDuration, formatRelative, intervalToDuration } from "date-fns";
import React, { useEffect, useState } from "react";

export const Countdown = ({
    start,
    children,
}: {
    start: number;
    children: React.ReactNode;
}): JSX.Element => {
    const [end, setEnd] = useState(Date.now());

    useEffect(() => {
        const interval = setInterval(() => setEnd(Date.now()), 1000);
        return () => {
            clearInterval(interval);
        };
    }, []);
    return (
        <div style={{ textAlign: "center" }}>
            <Spacer y={1} />
            {children} {formatRelative(start, end)}, in
            <div style={{ fontSize: "1.3em" }}>
                {formatDuration(
                    intervalToDuration({
                        start,
                        end,
                    })
                )}
            </div>
        </div>
    );
};
