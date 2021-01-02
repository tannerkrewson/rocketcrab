import { Grid, Spacer } from "@geist-ui/react";
import { formatRelative, differenceInCalendarDays, format } from "date-fns";
import React from "react";

export const FindTime = ({
    dates,
    now,
}: {
    dates: number[];
    now: number;
}): JSX.Element => (
    <div style={{ fontSize: ".85em", padding: "0 2em" }}>
        <Spacer y={0.5} />
        {Object.entries(
            dates
                .map((date) =>
                    (differenceInCalendarDays(date, now) < 7
                        ? formatRelative(date, now)
                        : format(date, "EEE, MMM do 'at' p")
                    )
                        .replaceAll(":00", "")
                        .replaceAll(" AM", "am")
                        .replaceAll(" PM", "pm")
                        .split(" at ")
                )
                // convert [ [day, time], [day, time], ... ]
                // to { day: [time, time, ...], day: [time, time, ...]}
                .reduce(
                    (prev, [day, time]) => ({
                        ...prev,
                        [day]: [...(prev[day] || []), time],
                    }),
                    {}
                )
        ).map(([day, times]: [string, string[]], i) => (
            <div key={i}>
                {i === 0 && "and "}
                {day} at{" "}
                <Grid.Container gap={0.4} justify="center">
                    {times.map((time) => (
                        <Grid xs={4} key={time}>
                            {time}
                        </Grid>
                    ))}
                </Grid.Container>
                <Spacer y={0.7} />
            </div>
        ))}
        ...and so on.
    </div>
);

export default FindTime;
