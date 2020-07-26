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
import { parseCookies, setCookie } from "nookies";

const CLIENT_GAME_LIBRARY = getClientGameLibrary();
const socket = socketIOClient();

export const Code = ({
    gameLibrary = { gameList: [], categories: [] },
    name,
}: CodeProps): JSX.Element => {
    const router = useRouter();
    const { code } = router.query;

    const [lobbyState, setLobbyState] = useState(initLobbyState());
    const { status, me, playerList, selectedGame, gameState } = lobbyState;

    // only ran with initial value due to the []
    useEffect(() => {
        socket.open();

        socket.on("update", (newLobbyState) => setLobbyState(newLobbyState));
        socket.on("invalid-name", () => alert("Name already in use"));

        return () => {
            socket.close();
            setLobbyState(initLobbyState());
        };
    }, []);

    useEffect(() => {
        // "code" will be undefined during Automatic Static Optimization
        if (code) socket.emit("join-lobby", { code, name });

        socket.on("invalid-lobby", () => router.push("/join?invalid=" + code));
    }, [code]);

    const onNameEntry = (name) => {
        socket.emit("name", name);

        setCookie(null, "name", name, {});
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
                />
            )}
        </>
    );
};

const initLobbyState = () => ({
    status: "loading" as string,
    playerList: [],
    me: { name: undefined },
    selectedGame: "",
    gameState: {} as GameState,
});

export const getServerSideProps: GetServerSideProps = async (
    ctx: GetServerSidePropsContext
): Promise<any> => {
    const { name = "" } = parseCookies(ctx);

    return {
        props: { gameLibrary: CLIENT_GAME_LIBRARY, name },
    };
};

type CodeProps = {
    gameLibrary: ClientGameLibrary;
    name?: string;
};

export default Code;
