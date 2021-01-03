import { useCallback, useEffect, useState } from "react";
import Swal from "sweetalert2";
import { ClientParty } from "../types/types";
import { logEvent } from "./analytics";
import { io } from "socket.io-client";
import { RocketcrabDexie } from "./dexie";
import { setCookie as setNookie } from "nookies";
import { NextRouter } from "next/router";
import { SocketEvent } from "../types/enums";

const socket = io();

export const useRocketcrabClientSocket = ({
    code,
    router,
    cookiePartyState,
    isReconnect,
}: UseRocketcrabClientSocketProps): UseRocketcrabClientSocketReturn => {
    const [partyState, setPartyState] = useState<ClientParty | undefined>();
    const [showReconnecting, setShowReconnecting] = useState(false);

    const { me, playerList, selectedGameId } = partyState || {};

    // only ran with initial value due to the []
    useEffect(() => {
        socket.open();

        socket.on(SocketEvent.UPDATE, (newPartyState: ClientParty) => {
            setPartyState(newPartyState);
            setShowReconnecting(false);

            if (Number.isInteger(newPartyState.me.id)) {
                setCookie("lastPartyState", JSON.stringify(newPartyState));
            }
        });
        socket.on(SocketEvent.INVALID_NAME, () => {
            if (code === "ffff") return;
            Swal.fire("Try again", "Name already in use", "error");
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
            setPartyState(undefined);
        };
    }, []);

    useEffect(() => {
        // "code" will be undefined during Automatic Static Optimization
        if (code && !partyState) {
            joinParty(code, cookiePartyState, isReconnect);
        }

        socket.io.on(SocketEvent.RECONNECT, () => {
            joinParty(code, partyState || cookiePartyState, true);
            setShowReconnecting(false);
        });

        socket.on(SocketEvent.INVALID_PARTY, () => {
            // todo: don't do this if showGame is true
            router.push("/join?invalid=" + code);
        });

        return () => {
            socket.io.off(SocketEvent.RECONNECT);
            socket.off(SocketEvent.INVALID_PARTY);
        };
    }, [code, partyState, isReconnect]);

    const onNameEntry = useCallback((enteredName) => {
        socket.emit(SocketEvent.NAME, enteredName);
    }, []);

    const onSelectGame = useCallback((gameId: string) => {
        socket.emit(SocketEvent.GAME_SELECT, gameId);
    }, []);

    const onStartGame = useCallback(() => {
        socket.emit(SocketEvent.GAME_START);

        const db = new RocketcrabDexie();
        db.addGame(selectedGameId);

        if (me?.isHost) {
            logEvent("party-numberOfPlayers", playerList.length.toString());
            logEvent("party-game", selectedGameId);
        }
    }, [playerList, selectedGameId]);

    const onExitGame = useCallback(() => {
        socket.emit(SocketEvent.GAME_EXIT);
    }, []);

    // give the host a little extra time (TODO probably remove)
    const onHostGameLoaded = useCallback(
        () => setTimeout(() => socket.emit(SocketEvent.HOST_GAME_LOADED), 2000),
        []
    );

    const onSendChat = useCallback((message) => {
        socket.emit(SocketEvent.CHAT_MESSAGE, message);
    }, []);

    return {
        partyState,
        onNameEntry,
        onSelectGame,
        onStartGame,
        onExitGame,
        onHostGameLoaded,
        showReconnecting,
        onSendChat,
    };
};

const joinParty = (
    code: string,
    partyState: ClientParty,
    reconnecting: boolean
) => {
    // if dev game, pick random name and submit
    if (code === "ffff") {
        const randFourDig = Math.floor(1000 + Math.random() * 9000);
        partyState.me.name = String(randFourDig);
    }

    socket.emit(SocketEvent.JOIN_PARTY, {
        code,
        // we don't need the playerList, so make it undefined.
        // not strictly necessary
        lastPartyState: { ...partyState, playerList: undefined },
        reconnecting,
    });
};

const setCookie = (key: string, value: any) =>
    setNookie(null, key, value, {
        maxAge: 2147483647,
    });

type UseRocketcrabClientSocketProps = {
    code: string;
    router: NextRouter;
    cookiePartyState?: ClientParty;
    isReconnect: boolean;
};

type UseRocketcrabClientSocketReturn = {
    partyState: ClientParty;
    onNameEntry: (enteredName: string) => void;
    onSelectGame: (gameId: string) => void;
    onStartGame: () => void;
    onExitGame: () => void;
    onHostGameLoaded: () => void;
    showReconnecting: boolean;
    onSendChat: (message: string) => void;
};
