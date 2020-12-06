import PrimaryButton from "../components/common/PrimaryButton";
import ButtonGroup from "../components/common/ButtonGroup";
import PageLayout from "../components/layout/PageLayout";
import { useEffect, useState } from "react";
import { postJson } from "../utils/utils";
import { useRouter } from "next/router";
import { io } from "socket.io-client";
import { SocketEvent } from "../types/enums";
import { ClientGameLibrary, FinderState } from "../types/types";
import { GetServerSideProps } from "next";
import { getClientGameLibrary } from "../config";

const socket = io();
const CLIENT_GAME_LIBRARY = getClientGameLibrary();

export const Find = ({
    gameLibrary = { gameList: [], categories: [] },
}: FindProps): JSX.Element => {
    const router = useRouter();
    const [newLoading, setNewLoading] = useState(false);
    const [showReconnecting, setShowReconnecting] = useState(false);
    const [finderState, setFinderState] = useState<FinderState | undefined>();

    const onClickNew = async (e) => {
        e.preventDefault();
        setNewLoading(true);

        const { code } = await postJson("/api/new-public");

        router.push("/" + code);
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

    return (
        <PageLayout reconnecting={showReconnecting}>
            <div className="description">Public Games</div>
            <div>
                {finderState?.publicPartyList?.map(
                    ({ code, playerList, selectedGameId }) => {
                        const selectedGame = gameLibrary.gameList.find(
                            ({ id }) => id === selectedGameId
                        );
                        const host = playerList.find((p) => p.isHost);
                        return (
                            <div key={code}>
                                <div>
                                    {host.name}
                                    &apos;s game{" "}
                                    {selectedGame
                                        ? "of " + selectedGame.name
                                        : ""}
                                </div>
                                <div>
                                    {playerList.length} player
                                    {playerList.length !== 1 ? "s" : ""}
                                </div>
                                <PrimaryButton
                                    onClick={() =>
                                        router.push("/[code]", "/" + code)
                                    }
                                >
                                    Join
                                </PrimaryButton>
                            </div>
                        );
                    }
                )}
            </div>
            <ButtonGroup>
                <PrimaryButton href="/" size="large">
                    Back
                </PrimaryButton>

                <PrimaryButton
                    onClick={onClickNew}
                    loading={newLoading}
                    size="large"
                >
                    Start Public Party
                </PrimaryButton>
            </ButtonGroup>
            <style jsx>{`
                .description {
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
