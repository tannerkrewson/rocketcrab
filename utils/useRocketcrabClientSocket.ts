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
            // if the disconnection was initiated by the server, we were kicked
            if (reason === "io server disconnect") {
                router.push("/");
            }
            // else the socket will automatically try to reconnect
            logEvent("common-reconnecting");
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

    const onNameEntry = useCallback((enteredName: string) => {
        socket.emit(SocketEvent.NAME, enteredName);
    }, []);

    const onSelectGame = useCallback((gameId: string) => {
        socket.emit(SocketEvent.GAME_SELECT, gameId);
    }, []);

    const onStartGame = useCallback(
        (gameId?: string) => {
            socket.emit(SocketEvent.GAME_START, gameId);

            const db = new RocketcrabDexie();
            db.addGame(selectedGameId);

            if (me?.isHost) {
                logEvent("party-numberOfPlayers", playerList.length.toString());
                logEvent("party-game", selectedGameId);
                logEvent(
                    "party-isPublic",
                    (!!partyState.publicEndDate).toString()
                );
            }
        },
        [playerList, selectedGameId]
    );

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
        logEvent("common-sendChat");
    }, []);

    const onKick = useCallback((playerId, name) => {
        Swal.fire({
            title: `Kick ${name}?`,
            showCancelButton: true,
            confirmButtonText: `Kick player`,
            icon: "warning",
        }).then(({ isConfirmed }) => {
            if (isConfirmed) {
                Swal.fire({
                    title: `Ban ${name} as well?`,
                    text:
                        "This may prevent anyone else on the same network as this player from joining as well. If you want to let them join again, you'll have to make a new party.",
                    showCancelButton: true,
                    confirmButtonText: `Kick & ban player`,
                    cancelButtonText: "Just kick",
                    icon: "warning",
                }).then(({ isConfirmed }) => {
                    if (isConfirmed) {
                        socket.emit(SocketEvent.KICK_PLAYER, {
                            playerId,
                            isBan: true,
                        });
                        Swal.fire(
                            "Kicked & banned!",
                            "Good riddance!",
                            "success"
                        );
                        logEvent("common-ban");
                    } else {
                        socket.emit(SocketEvent.KICK_PLAYER, {
                            playerId,
                            isBan: false,
                        });
                        Swal.fire("Kicked!", "Bye bye!", "success");
                        logEvent("common-kick");
                    }
                });
            }
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
        onSendChat,
        onKick,
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
    onStartGame: (gameId?: string) => void;
    onExitGame: () => void;
    onHostGameLoaded: () => void;
    showReconnecting: boolean;
    onSendChat: (message: string) => void;
    onKick: (id: number, name: string) => void;
};
