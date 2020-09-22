import { useCallback, useEffect, useState } from "react";
import { GetServerSidePropsContext, GetServerSideProps } from "next";
import { useRouter } from "next/router";
import socketIOClient from "socket.io-client";

import PageLayout from "../components/templates/PageLayout";
import PartyScreen from "../components/organisms/PartyScreen";
import NameEntry from "../components/organisms/NameEntry";
import GameLayout from "../components/templates/GameLayout";

import {
    GameState,
    ClientGameLibrary,
    JoinGameURL,
    ClientParty,
} from "../types/types";
import { getClientGameLibrary } from "../config";
import { parseCookies, setCookie as setNookie } from "nookies";
import Connecting from "../components/atoms/Connecting";
import { logEvent } from "../utils/analytics";
import { PartyStatus } from "../types/enums";

const CLIENT_GAME_LIBRARY = getClientGameLibrary();
const socket = socketIOClient();

export const Code = ({
    gameLibrary = { gameList: [], categories: [] },
    previousName,
    previousId,
}: CodeProps): JSX.Element => {
    const router = useRouter();
    const { code } = router.query;

    const [partyState, setPartyState] = useState(initPartyState());
    const [showReconnecting, setShowReconnecting] = useState(false);
    const [deemphasize, setDeemphasize] = useState(false);
    const { status, me, playerList, selectedGameId, gameState } = partyState;

    const { isHost } = me;

    // only ran with initial value due to the []
    useEffect(() => {
        socket.open();

        socket.on("update", (newPartyState: ClientParty) => {
            setPartyState(newPartyState);
            setShowReconnecting(false);
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
            setPartyState(initPartyState());
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

    useEffect(() => {
        if (!Number.isInteger(me.id)) return;

        setCookie("previousCode", code as string);
        setCookie("previousId", me.id);
    }, [me.id]);

    const onNameEntry = useCallback((enteredName) => {
        socket.emit("name", enteredName);
        setCookie("previousName", enteredName);
    }, []);

    const onSelectGame = useCallback((gameId: string) => {
        socket.emit("game-select", gameId);
    }, []);

    const onStartGame = useCallback(() => {
        socket.emit("game-start");

        logEvent("party-numberOfPlayers", playerList.length.toString());
        logEvent("party-game", selectedGameId);
    }, [playerList, selectedGameId]);

    const onExitGame = useCallback(() => {
        socket.emit("game-exit");
    }, []);

    // give the host a little extra time (TODO probably remove)
    const onHostGameLoaded = useCallback(
        () => setTimeout(() => socket.emit("host-game-loaded"), 2000),
        []
    );

    const onInOutParty = useCallback(
        (outOfParty) => setDeemphasize(outOfParty),
        [setDeemphasize]
    );

    const joinParty = useCallback(() => {
        socket.emit("join-party", {
            code,
            id: previousId,
            name: previousName,
        });
    }, []);

    const showLoading = status === "loading";
    const showNameEntry = !showLoading && !me.name;
    const showParty = !showLoading && !showNameEntry && status === "party";
    const showGame = !showLoading && !showNameEntry && status === "ingame";

    return (
        <>
            {!showGame && (
                <PageLayout
                    path={code as string}
                    loading={showLoading}
                    deemphasize={deemphasize}
                >
                    <>
                        {showNameEntry && (
                            <NameEntry onNameEntry={onNameEntry} code={code} />
                        )}
                        {showParty && (
                            <PartyScreen
                                playerList={playerList}
                                gameLibrary={gameLibrary}
                                onSelectGame={onSelectGame}
                                selectedGameId={selectedGameId}
                                onStartGame={onStartGame}
                                resetName={() => onNameEntry("")}
                                meId={me.id}
                                isHost={isHost}
                                onInOutParty={onInOutParty}
                            />
                        )}
                    </>
                </PageLayout>
            )}
            {showGame && (
                <GameLayout
                    path={code as string}
                    gameState={gameState}
                    selectedGameId={selectedGameId}
                    onExitGame={onExitGame}
                    onStartGame={onStartGame}
                    onHostGameLoaded={onHostGameLoaded}
                    gameLibrary={gameLibrary}
                    playerList={playerList}
                    thisPlayer={me}
                />
            )}
            {showReconnecting && <Connecting />}
        </>
    );
};

const initPartyState = (): ClientParty => ({
    status: PartyStatus.loading,
    playerList: [],
    me: { id: undefined, name: undefined, isHost: undefined },
    selectedGameId: "",
    gameState: {
        status: undefined,
        joinGameURL: {} as JoinGameURL,
    } as GameState,
});

const setCookie = (key: string, value: any) =>
    setNookie(null, key, value, {
        maxAge: 2147483647,
    });

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
