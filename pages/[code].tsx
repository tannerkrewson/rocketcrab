import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import socketIOClient from "socket.io-client";
import PageLayout from "../components/PageLayout";

const socket = socketIOClient();

export const Code = () => {
    const router = useRouter();
    const { code } = router.query;

    const [lobbyState, setLobbyState] = useState(initLobbyState());
    const { status } = lobbyState;

    // only ran with initial value due to the []
    useEffect(() => {
        socket.on("update", (newLobbyState) => {
            setLobbyState(newLobbyState);
        });

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

    const showLoading = status === "loading";
    const showLobby = status.startsWith("lobby");

    return (
        <PageLayout path={code}>
            {showLoading && <div>Loading...</div>}
            {!showLoading && (
                <>
                    {showLobby && (
                        <>
                            <div>Lobby placeholder</div>
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
});

export default Code;
