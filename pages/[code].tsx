import { useCallback, useEffect, useState } from "react";
import { GetServerSidePropsContext, GetServerSideProps } from "next";
import { useRouter } from "next/router";

import PageLayout from "../components/layout/PageLayout";
import PartyScreen from "../components/party/PartyScreen";
import NameEntry from "../components/party/NameEntry";
import GameLayout from "../components/layout/GameLayout";

import { ClientGameLibrary, ClientParty } from "../types/types";
import { getClientGameLibrary } from "../config";
import { parseCookies } from "nookies";

import { useRocketcrabClientSocket } from "../utils/useRocketcrabClientSocket";
import { useChat } from "../utils/useChat";

const CLIENT_GAME_LIBRARY = getClientGameLibrary();

export const Code = ({
    gameLibrary = { gameList: [], categories: [] },
    lastPartyState,
    isReconnect,
}: CodeProps): JSX.Element => {
    const router = useRouter();
    const code = router?.query?.code as string;

    const previousName = lastPartyState?.me?.name;

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
        onSetIsPublic,
    } = useRocketcrabClientSocket({
        code,
        router,
        cookiePartyState: lastPartyState,
        isReconnect,
    });

    const { status, me, chat } = partyState || {};

    const { unreadMsgCount, clearUnreadMsgCount, newestMsg } = useChat(
        chat,
        me
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
        (outOfParty) => setDeemphasize(outOfParty),
        [setDeemphasize]
    );

    const showLoading = status === "loading";
    const showNameEntry = !showLoading && !me?.name;
    //const showParty = !showLoading && !showNameEntry && status === "party";
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
            />
        );
    }

    return (
        <PageLayout
            path={code as string}
            loading={showLoading}
            deemphasize={deemphasize}
            reconnecting={showReconnecting}
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
                    onSetIsPublic={onSetIsPublic}
                />
            )}
        </PageLayout>
    );
};

export const getServerSideProps: GetServerSideProps = async (
    ctx: GetServerSidePropsContext
): Promise<any> => {
    const code = ctx?.query?.code;

    let lastPartyState: ClientParty = { me: {} } as ClientParty;
    let isReconnect = false;

    try {
        lastPartyState = JSON.parse(
            parseCookies(ctx).lastPartyState
        ) as ClientParty;

        isReconnect = lastPartyState.code === code;
        if (!isReconnect) {
            lastPartyState.me.id = null;
        }
        // eslint-disable-next-line no-empty
    } catch (error) {}

    return {
        props: {
            gameLibrary: CLIENT_GAME_LIBRARY,
            ...(lastPartyState ? { lastPartyState } : {}),
            isReconnect,
        },
    };
};

type CodeProps = {
    gameLibrary: ClientGameLibrary;
    lastPartyState?: ClientParty;
    previousId?: string;
    isReconnect: boolean;
};

export default Code;
