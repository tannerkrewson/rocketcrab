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
import Swal from "sweetalert2";
import GameDetail from "../components/detail/GameDetail";
import { FinderInfoCard } from "../components/find/FinderInfoCard";

const socket = io();
const CLIENT_GAME_LIBRARY = getClientGameLibrary();

export const Find = ({
    gameLibrary = { gameList: [], categories: [] },
}: FindProps): JSX.Element => {
    const router = useRouter();
    const [newLoading, setNewLoading] = useState(false);
    const [showReconnecting, setShowReconnecting] = useState(false);
    const [finderState, setFinderState] = useState<FinderState | undefined>();
    const [gameInfoVisible, setGameInfoVisible] = useState("");

    const { isActive, publicPartyList, finderActiveDates, subscriberCount } =
        finderState ?? {};

    const onClickNew = async (e) => {
        e.preventDefault();
        setNewLoading(true);

        const result = await postJson("/api/new-public").catch(() => {
            setNewLoading(false);
            Swal.fire({
                title: "Try again",
                text:
                    "The server is not allowing public parties to be created right now... maybe you were just a smidge too early? 😊",
                icon: "error",
                heightAuto: false,
            });
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

    if (gameInfoVisible) {
        const selectedGame = gameLibrary.gameList.find(
            ({ id }) => id === gameInfoVisible
        );
        return (
            <PageLayout reconnecting={showReconnecting} deemphasize={true}>
                <div style={{ textAlign: "center" }}>
                    <GameDetail
                        game={selectedGame}
                        allCategories={gameLibrary.categories}
                    />
                    <PrimaryButton onClick={() => setGameInfoVisible("")}>
                        Back to Public Parties
                    </PrimaryButton>
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout reconnecting={showReconnecting}>
            <div className="description">Public Parties (beta)</div>
            {isActive ? (
                <>
                    {publicPartyList?.length ? (
                        publicPartyList?.map((party) => (
                            <PublicGame
                                key={party.code}
                                party={party}
                                gameLibrary={gameLibrary}
                                onWhatIs={setGameInfoVisible}
                            />
                        ))
                    ) : (
                        <div style={{ textAlign: "center" }}>
                            No public parties found. 😞{" "}
                            <div style={{ display: "inline-block" }}>
                                You should make one! 🥰
                            </div>
                        </div>
                    )}
                    <FinderInfoCard
                        subscriberCount={subscriberCount}
                        subscriberCountMsg="here still looking for a party to choose!"
                        showCountdown={!!finderActiveDates?.lastStart}
                        countdownStart={
                            finderActiveDates.lastStart + FINDER_ACTIVE_MS
                        }
                        countdownMsg="Public parties will close"
                    />
                </>
            ) : (
                <div style={{ textAlign: "center" }}>
                    <div>
                        To make sure there are enough players, public games open
                        roughly every four hours from Thursday to Saturday.
                    </div>
                    <FinderInfoCard
                        subscriberCount={subscriberCount}
                        subscriberCountMsg="waiting on this page."
                        showCountdown={!!finderActiveDates?.nextStart}
                        countdownStart={finderActiveDates?.nextStart}
                        countdownMsg="Public parties will close"
                        findTimeDates={finderActiveDates?.nextWeekOfStarts}
                    />
                </div>
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
