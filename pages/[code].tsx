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
    } = useRocketcrabClientSocket({
        code,
        router,
        cookiePartyState: lastPartyState,
        isReconnect,
    });

    const {
        status,
        me,
        playerList,
        selectedGameId,
        gameState,
        isPublic,
        publicEndDate,
    } = partyState || {};

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
                path={code as string}
                gameState={gameState}
                selectedGameId={selectedGameId}
                onExitGame={onExitGame}
                onStartGame={onStartGame}
                onHostGameLoaded={onHostGameLoaded}
                gameLibrary={gameLibrary}
                playerList={playerList}
                thisPlayer={me}
                reconnecting={showReconnecting}
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
                    playerList={playerList}
                    gameLibrary={gameLibrary}
                    onSelectGame={onSelectGame}
                    selectedGameId={selectedGameId}
                    onStartGame={onStartGame}
                    resetName={() => onNameEntry("")}
                    meId={me?.id}
                    isHost={me?.isHost}
                    onInOutParty={onInOutParty}
                    isPublic={isPublic}
                    publicEndDate={publicEndDate}
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
