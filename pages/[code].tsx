import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import socketIOClient from "socket.io-client";

import PageLayout from "../components/organisms/PageLayout";
import Lobby from "../components/organisms/Lobby";
import NameEntry from "../components/organisms/NameEntry";

const socket = socketIOClient();

export const Code = () => {
    const router = useRouter();
    const { code } = router.query;

    const [lobbyState, setLobbyState] = useState(initLobbyState());
    const { status, me, playerList, gameList, selectedGame } = lobbyState;

    // only ran with initial value due to the []
    useEffect(() => {
        socket.on("update", (newLobbyState) => setLobbyState(newLobbyState));
        socket.on("invalid-name", () => alert("Name already in use"));

        return () => {
            socket.close();
            setLobbyState(initLobbyState());
        };
    }, []);

    useEffect(() => {
        // "code" will be undefined during Automatic Static Optimization
        if (code) socket.emit("join-lobby", { code });

        socket.on("invalid-lobby", () => router.push("/join?invalid=" + code));
    }, [code]);

    const onNameEntry = (name) => {
        socket.emit("name", name);
        // TODO: store in cookie
    };

    const onGameSelect = (gameName: string) => {
        socket.emit("game-select", gameName);
    };

    const showLoading = status === "loading";
    const showNameEntry = !showLoading && !me.name;
    const showLobby = !showNameEntry && status.startsWith("lobby");

    return (
        <PageLayout path={code as string}>
            {showLoading && <div>Loading...</div>}
            {!showLoading && (
                <>
                    {showNameEntry && (
                        <NameEntry
                            onNameEntry={onNameEntry}
                            code={code}
                            socket={socket}
                        />
                    )}
                    {showLobby && (
                        <>
                            <Lobby
                                playerList={playerList}
                                gameList={gameList}
                                onGameSelect={onGameSelect}
                                selectedGame={selectedGame}
                            />
                            <div>{JSON.stringify(lobbyState)}</div>
                        </>
                    )}
                </>
            )}
        </PageLayout>
    );
};

const initLobbyState = () => ({
    status: "loading",
    playerList: [],
    gameList: [],
    me: { name: undefined },
});

export default Code;
