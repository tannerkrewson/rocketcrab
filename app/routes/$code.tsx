import React, { useCallback, useEffect, useState } from "react";
import {
    createFileRoute,
    useParams,
    useNavigate,
} from "@tanstack/react-router";

import PageLayout from "../../components/layout/PageLayout";
import PartyScreen from "../../components/party/PartyScreen";
import NameEntry from "../../components/party/NameEntry";
import GameLayout from "../../components/layout/GameLayout";

import { ClientGameLibrary, ClientParty } from "../../types/types";
import { GAME_LIBRARY } from "../../config";

import { useRocketcrabClientSocket } from "../../utils/useRocketcrabClientSocketTanStack";
import { useChat } from "../../utils/useChat";
import { useMode } from "../../utils/ModeContext";
import { getCookie } from "../../utils/cookies";
import type { RocketcrabMode } from "../../types/enums";

/**
 * Party route — handles party code URLs (/:code).
 *
 * The cookie for reconnection (lastPartyState) is read on the client
 * after mount, since it is a client-side cookie set by JavaScript.
 * SSR cannot read it consistently.
 */
export const Route = createFileRoute("/$code")({
    component: PartyRouteComponent,
});

function PartyRouteComponent() {
    const { code } = useParams({ from: "/$code" });
    const navigate = useNavigate();
    const mode = useMode();

    // Resolve the mode-appropriate game library
    const gameLibrary: ClientGameLibrary =
        GAME_LIBRARY[mode as RocketcrabMode] || GAME_LIBRARY.MAIN;

    // Read the lastPartyState cookie on mount (client-side only)
    const [lastPartyState, setLastPartyState] = useState<
        ClientParty | undefined
    >();
    const [isReconnect, setIsReconnect] = useState(false);
    const [cookieLoaded, setCookieLoaded] = useState(false);

    useEffect(() => {
        try {
            const raw = getCookie("lastPartyState");
            if (raw) {
                const parsed = JSON.parse(raw) as ClientParty;
                setLastPartyState(parsed);
                const reconnect = parsed.code === code;
                setIsReconnect(reconnect);
                if (!reconnect && parsed.me) {
                    parsed.me.id = null;
                }
            }
        } catch {
            // Cookie not present or malformed — proceed without reconnect
        }
        setCookieLoaded(true);
    }, [code]);

    const previousName = lastPartyState?.me?.name;

    // Build a minimal router-like object for the socket hook
    const routerLike = {
        locale: mode,
        push: (path: string) => navigate({ to: path }),
        query: { code },
    };

    const {
        partyState,
        onNameEntry,
        onSelectGame,
        onStartGame,
        onExitGame,
        onHostGameLoaded,
        showReconnecting,
        onSendChat,
        onKick,
    } = useRocketcrabClientSocket({
        code,
        router: routerLike,
        cookiePartyState: lastPartyState,
        isReconnect,
        gameLibrary,
    });

    const { status, me, chat } = partyState || {};

    const { unreadMsgCount, clearUnreadMsgCount, newestMsg } = useChat(
        chat,
        me,
    );

    const [myLastValidName, setMyLastValidName] = useState("");
    useEffect(() => {
        if (me?.name) {
            setMyLastValidName(me?.name);
        } else if (previousName) {
            setMyLastValidName(previousName);
        }
    }, [me?.name, previousName]);

    const [deemphasize, setDeemphasize] = useState(false);
    const onInOutParty = useCallback(
        (outOfParty: boolean) => setDeemphasize(outOfParty),
        [],
    );

    const showLoading = !cookieLoaded || status === "loading";
    const showNameEntry = !showLoading && !me?.name;
    const showGame = !showLoading && !showNameEntry && status === "ingame";

    if (showGame) {
        return (
            <GameLayout
                partyState={partyState}
                onExitGame={onExitGame}
                onStartGame={onStartGame}
                onHostGameLoaded={onHostGameLoaded}
                onSendChat={onSendChat}
                gameLibrary={gameLibrary}
                thisPlayer={me}
                reconnecting={showReconnecting}
                onKick={onKick}
                unreadMsgCount={unreadMsgCount}
                newestMsg={newestMsg}
                clearUnreadMsgCount={clearUnreadMsgCount}
                mode={mode}
            />
        );
    }

    return (
        <PageLayout
            path={code}
            loading={showLoading}
            deemphasize={deemphasize}
            reconnecting={showReconnecting}
            mode={mode}
        >
            {showNameEntry ? (
                <NameEntry
                    onNameEntry={onNameEntry}
                    previousName={myLastValidName}
                />
            ) : (
                <PartyScreen
                    partyState={partyState}
                    thisPlayer={me}
                    gameLibrary={gameLibrary}
                    onSelectGame={onSelectGame}
                    onStartGame={onStartGame}
                    resetName={() => onNameEntry("")}
                    onInOutParty={onInOutParty}
                    onSendChat={onSendChat}
                    onKick={onKick}
                    unreadMsgCount={unreadMsgCount}
                    clearUnreadMsgCount={clearUnreadMsgCount}
                />
            )}
        </PageLayout>
    );
}
