import PrimaryButton from "../components/common/PrimaryButton";
import ButtonGroup from "../components/common/ButtonGroup";
import PageLayout from "../components/layout/PageLayout";
import React, { useEffect, useState } from "react";
import { postJson } from "../utils/utils";
import { useRouter } from "next/router";
import { io } from "socket.io-client";
import { SocketEvent } from "../types/enums";
import {
    ClientGameLibrary,
    FinderState,
    FINDER_ACTIVE_MS,
} from "../types/types";
import { GetServerSideProps } from "next";
import { getClientGameLibrary } from "../config";
import PublicGame from "../components/find/PublicGame";
import { Spacer } from "@geist-ui/react";
import Swal from "sweetalert2";
import { FindTime } from "../components/find/FindTime";
import { Countdown } from "../components/find/Countdown";

const socket = io();
const CLIENT_GAME_LIBRARY = getClientGameLibrary();

export const Find = ({
    gameLibrary = { gameList: [], categories: [] },
}: FindProps): JSX.Element => {
    const router = useRouter();
    const [newLoading, setNewLoading] = useState(false);
    const [showReconnecting, setShowReconnecting] = useState(false);
    const [finderState, setFinderState] = useState<FinderState | undefined>();

    const { isActive, publicPartyList, finderActiveDates, subscriberCount } =
        finderState ?? {};

    const onClickNew = async (e) => {
        e.preventDefault();
        setNewLoading(true);

        const result = await postJson("/api/new-public").catch(() => {
            setNewLoading(false);
            Swal.fire(
                "Try again",
                "The server is not allowing public parties to be created right now... maybe you were just a smidge too early? 😊",
                "error"
            );
        });

        if (result) {
            const { code } = result;

            router.push("/" + code);
        }
    };

    useEffect(() => {
        socket.open();

        socket.emit(SocketEvent.FINDER_SUBSCRIBE);

        socket.on(SocketEvent.FINDER_UPDATE, (newFinderState: FinderState) => {
            setFinderState(newFinderState);
            setShowReconnecting(false);
        });

        socket.on(SocketEvent.DISCONNECT, (reason) => {
            // if the disconnection was initiated by the server
            if (reason === "io server disconnect") {
                // reconnect manually
                socket.connect();
            }
            // else the socket will automatically try to reconnect

            setShowReconnecting(true);
        });

        return () => {
            socket.close();
            setFinderState(undefined);
        };
    }, []);

    const scs = subscriberCount === 1;

    return (
        <PageLayout reconnecting={showReconnecting}>
            <div className="description">Public Parties (beta)</div>
            {isActive ? (
                <>
                    {publicPartyList?.map((party) => (
                        <PublicGame
                            key={party.code}
                            party={party}
                            gameLibrary={gameLibrary}
                        />
                    ))}
                    {!finderState?.publicPartyList?.length &&
                        "No public parties found. 😞 You should make one! 🥰 "}
                    {subscriberCount > 0 && (
                        <div style={{ textAlign: "center" }}>
                            <Spacer y={1} />
                            There {scs ? "is " : "are "}
                            {subscriberCount} other
                            {scs ? " person " : " people "}
                            here still looking for a party to choose!
                        </div>
                    )}
                    {finderActiveDates?.lastStart && (
                        <>
                            <Spacer y={0.5} />
                            <Countdown
                                start={
                                    finderActiveDates.lastStart +
                                    FINDER_ACTIVE_MS
                                }
                            >
                                Public parties will close
                            </Countdown>
                        </>
                    )}
                    <Spacer y={1.1} />
                </>
            ) : (
                finderActiveDates && (
                    <div style={{ textAlign: "center" }}>
                        <div>
                            To make sure there are enough players, public games
                            open roughly every four hours from Thursday to
                            Saturday.
                        </div>
                        {subscriberCount > 0 && (
                            <div>
                                <Spacer y={1} />
                                There {scs ? "is " : "are "}
                                {subscriberCount} other
                                {scs ? " person " : " people "}
                                waiting on this page.
                            </div>
                        )}
                        <Spacer y={0.5} />
                        <Countdown start={finderActiveDates.nextStart}>
                            Public parties will open next
                        </Countdown>

                        <FindTime dates={finderActiveDates.nextWeekOfStarts} />

                        <Spacer y={1.1} />
                    </div>
                )
            )}

            <ButtonGroup>
                <PrimaryButton href="/" size="large">
                    Back
                </PrimaryButton>

                {isActive && (
                    <PrimaryButton
                        onClick={onClickNew}
                        loading={newLoading}
                        size="large"
                    >
                        Start Public Party
                    </PrimaryButton>
                )}
            </ButtonGroup>
            <style jsx>{`
                .description {
                    font-size: 1.1em;
                    text-align: center;
                    margin-bottom: 1em;
                }
            `}</style>
        </PageLayout>
    );
};

export const getServerSideProps: GetServerSideProps = async () => ({
    props: {
        gameLibrary: CLIENT_GAME_LIBRARY,
    },
});

type FindProps = {
    gameLibrary: ClientGameLibrary;
};

export default Find;
