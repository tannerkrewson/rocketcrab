import { useCallback, useState } from "react";
import { GetServerSidePropsContext, GetServerSideProps } from "next";
import { useRouter } from "next/router";

import PageLayout from "../components/layout/PageLayout";
import PartyScreen from "../components/party/PartyScreen";
import NameEntry from "../components/party/NameEntry";
import GameLayout from "../components/layout/GameLayout";

import { ClientGameLibrary } from "../types/types";
import { getClientGameLibrary } from "../config";
import { parseCookies } from "nookies";
import Connecting from "../components/layout/Connecting";

import { useRocketcrabClientSocket } from "../utils/useRocketcrabClientSocket";

const CLIENT_GAME_LIBRARY = getClientGameLibrary();

export const Code = ({
    gameLibrary = { gameList: [], categories: [] },
    previousName,
    previousId,
}: CodeProps): JSX.Element => {
    const router = useRouter();
    const { code } = router.query;

    const {
        partyState,
        onNameEntry,
        onSelectGame,
        onStartGame,
        onExitGame,
        onHostGameLoaded,
        showReconnecting,
    } = useRocketcrabClientSocket({ code, router, previousName, previousId });

    const { status, me, playerList, selectedGameId, gameState } = partyState;
    const { isHost } = me;

    const [deemphasize, setDeemphasize] = useState(false);
    const onInOutParty = useCallback(
        (outOfParty) => setDeemphasize(outOfParty),
        [setDeemphasize]
    );

    const showLoading = status === "loading";
    const showNameEntry = !showLoading && !me.name;
    //const showParty = !showLoading && !showNameEntry && status === "party";
    const showGame = !showLoading && !showNameEntry && status === "ingame";

    if (showReconnecting) {
        return <Connecting />;
    }

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
            />
        );
    }

    return (
        <PageLayout
            path={code as string}
            loading={showLoading}
            deemphasize={deemphasize}
        >
            {showNameEntry ? (
                <NameEntry onNameEntry={onNameEntry} code={code} />
            ) : (
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
        </PageLayout>
    );
};

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
