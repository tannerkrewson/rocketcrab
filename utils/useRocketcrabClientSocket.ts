import { useCallback, useEffect, useState } from "react";
import { ClientParty } from "../types/types";
import { logEvent } from "./analytics";
import socketIOClient from "socket.io-client";
import { RocketcrabDexie } from "./dexie";
import { setCookie as setNookie } from "nookies";
import { NextRouter } from "next/router";
const socket = socketIOClient();

export const useRocketcrabClientSocket = ({
    code,
    router,
    cookiePartyState,
}: UseRocketcrabClientSocketProps): UseRocketcrabClientSocketReturn => {
    const [partyState, setPartyState] = useState(cookiePartyState);
    const [showReconnecting, setShowReconnecting] = useState(false);

    const { me, playerList, selectedGameId } = partyState || {};

    // only ran with initial value due to the []
    useEffect(() => {
        socket.open();

        socket.on("update", (newPartyState: ClientParty) => {
            setPartyState(newPartyState);
            setShowReconnecting(false);

            if (Number.isInteger(newPartyState.me.id)) {
                setCookie("lastPartyState", JSON.stringify(newPartyState));
            }
        });
        socket.on("invalid-name", () => {
            if (code === "ffff") return;
            alert("Name already in use");
        });

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
            joinParty();
            setShowReconnecting(false);
        });

        return () => {
            socket.close();
            setPartyState(undefined);
        };
    }, []);

    useEffect(() => {
        // "code" will be undefined during Automatic Static Optimization
        if (code) {
            joinParty();
        }

        socket.on("invalid-party", () => {
            // todo: don't do this if showGame is true
            router.push("/join?invalid=" + code);
        });
    }, [code]);

    const onNameEntry = useCallback((enteredName) => {
        socket.emit("name", enteredName);
    }, []);

    const onSelectGame = useCallback((gameId: string) => {
        socket.emit("game-select", gameId);
    }, []);

    const onStartGame = useCallback(() => {
        socket.emit("game-start");

        const db = new RocketcrabDexie();
        db.addGame(selectedGameId);

        if (me?.isHost) {
            logEvent("party-numberOfPlayers", playerList.length.toString());
            logEvent("party-game", selectedGameId);
        }
    }, [playerList, selectedGameId]);

    const onExitGame = useCallback(() => {
        socket.emit("game-exit");
    }, []);

    // give the host a little extra time (TODO probably remove)
    const onHostGameLoaded = useCallback(
        () => setTimeout(() => socket.emit("host-game-loaded"), 2000),
        []
    );

    const joinParty = useCallback(() => {
        socket.emit("join-party", {
            code,
            lastPartyState: partyState,
        });
    }, []);

    return {
        partyState,
        onNameEntry,
        onSelectGame,
        onStartGame,
        onExitGame,
        onHostGameLoaded,
        showReconnecting,
    };
};

const setCookie = (key: string, value: any) =>
    setNookie(null, key, value, {
        maxAge: 2147483647,
    });

type UseRocketcrabClientSocketProps = {
    code: string | string[];
    router: NextRouter;
    cookiePartyState?: ClientParty;
};

type UseRocketcrabClientSocketReturn = {
    partyState: ClientParty;
    onNameEntry: (enteredName: any) => void;
    onSelectGame: (gameId: string) => void;
    onStartGame: () => void;
    onExitGame: () => void;
    onHostGameLoaded: () => void;
    showReconnecting: boolean;
};
