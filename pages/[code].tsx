import { useEffect, useState } from "react";
import { GetServerSidePropsContext, GetServerSideProps } from "next";
import { useRouter } from "next/router";
import socketIOClient from "socket.io-client";

import PageLayout from "../components/templates/PageLayout";
import Lobby from "../components/organisms/Lobby";
import NameEntry from "../components/organisms/NameEntry";
import GameLayout from "../components/templates/GameLayout";

import { GameState, ClientGameLibrary } from "../types/types";
import { getClientGameLibrary } from "../config";
import { parseCookies, setCookie as setNookie } from "nookies";
import Connecting from "../components/atoms/Connecting";

const CLIENT_GAME_LIBRARY = getClientGameLibrary();
const socket = socketIOClient();

export const Code = ({
    gameLibrary = { gameList: [], categories: [] },
    previousName,
    previousId,
}: CodeProps): JSX.Element => {
    const router = useRouter();
    const { code } = router.query;

    const [lobbyState, setLobbyState] = useState(initLobbyState());
    const [showReconnecting, setShowReconnecting] = useState(false);
    const { status, me, playerList, selectedGame, gameState } = lobbyState;

    // only ran with initial value due to the []
    useEffect(() => {
        socket.open();

        socket.on("update", (newLobbyState) => {
            setLobbyState(newLobbyState);
            setShowReconnecting(false);
        });
        socket.on("invalid-name", () => alert("Name already in use"));

        socket.on("disconnect", (reason) => {
            // if the disconnection was initiated by the server
            if (reason === "io server disconnect") {
                // reconnect manually
                socket.connect();
            }
            // else the socket will automatically try to reconnect

            setShowReconnecting(true);
        });

        socket.on("reconnect", () => {
            joinLobby();
            setShowReconnecting(false);
        });

        return () => {
            socket.close();
            setLobbyState(initLobbyState());
        };
    }, []);

    useEffect(() => {
        // "code" will be undefined during Automatic Static Optimization
        if (code) {
            joinLobby();
        }

        socket.on("invalid-lobby", () => {
            // todo: don't do this if showGame is true
            router.push("/join?invalid=" + code);
        });
    }, [code]);

    useEffect(() => {
        if (!Number.isInteger(me.id)) return;

        setCookie("previousCode", code as string);
        setCookie("previousId", me.id);
    }, [me.id]);

    const onNameEntry = (enteredName) => {
        socket.emit("name", enteredName);
        setCookie("previousName", enteredName);
    };

    const onSelectGame = (gameName: string) => {
        socket.emit("game-select", gameName);
    };

    const onStartGame = () => {
        socket.emit("game-start");
    };

    const onExitGame = () => {
        socket.emit("game-exit");
    };

    const joinLobby = () => {
        socket.emit("join-lobby", {
            code,
            id: previousId,
            name: previousName,
        });
    };

    const showLoading = status === "loading";
    const showNameEntry = !showLoading && !me.name;
    const showLobby = !showLoading && !showNameEntry && status === "lobby";
    const showGame = !showLoading && !showNameEntry && status === "ingame";

    return (
        <>
            {!showGame && (
                <PageLayout path={code as string} loading={showLoading}>
                    <>
                        {showNameEntry && (
                            <NameEntry onNameEntry={onNameEntry} code={code} />
                        )}
                        {showLobby && (
                            <Lobby
                                playerList={playerList}
                                gameLibrary={gameLibrary}
                                onSelectGame={onSelectGame}
                                selectedGame={selectedGame}
                                onStartGame={onStartGame}
                                resetName={() => onNameEntry("")}
                                meId={me.id}
                            />
                        )}
                    </>
                </PageLayout>
            )}
            {showGame && (
                <GameLayout
                    path={code as string}
                    gameState={gameState}
                    onExitGame={onExitGame}
                    onStartGame={onStartGame}
                    gameLibrary={gameLibrary}
                    playerList={playerList}
                />
            )}
            {showReconnecting && <Connecting />}
        </>
    );
};

const initLobbyState = () => ({
    status: "loading" as string,
    playerList: [],
    me: { id: undefined, name: undefined },
    selectedGame: "",
    gameState: {} as GameState,
});

const setCookie = (key: string, value: any) => setNookie(null, key, value, {});

export const getServerSideProps: GetServerSideProps = async (
    ctx: GetServerSidePropsContext
): Promise<any> => {
    const {
        query: { code },
    } = ctx;
    const { previousCode, previousId, previousName = "" } = parseCookies(ctx);

    const isReconnect = previousCode === code;

    return {
        props: {
            gameLibrary: CLIENT_GAME_LIBRARY,
            previousName,
            previousId: isReconnect ? Number.parseInt(previousId) : null,
        },
    };
};

type CodeProps = {
    gameLibrary: ClientGameLibrary;
    previousName?: string;
    previousId?: number;
};

export default Code;
