import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import React, { useCallback } from "react";
import GameLibrary from "../components/library/GameLibrary";
import PageLayout from "../components/layout/PageLayout";
import { getClientGameLibrary } from "../config";
import { ClientGameLibrary } from "../types/types";
import { useLibraryState } from "../utils/utils";

const CLIENT_GAME_LIBRARY = getClientGameLibrary();

export const Library = ({ gameLibrary }: LibraryProps): JSX.Element => {
    const router = useRouter();

    const onDone = useCallback(() => router.back(), [router]);

    const onViewGame = useCallback(
        (gameId) => {
            router.push("/game/[gameid]", "/game/" + gameId);
        },
        [router]
    );

    const libraryState = useLibraryState();

    return (
        <PageLayout>
            <GameLibrary
                gameLibrary={gameLibrary}
                backToLabel="rocketcrab.com"
                onDone={onDone}
                setViewingGameId={onViewGame}
                libraryState={libraryState}
            />
        </PageLayout>
    );
};

type LibraryProps = {
    gameLibrary: ClientGameLibrary;
};

export const getStaticProps: GetServerSideProps = async () => ({
    props: {
        gameLibrary: CLIENT_GAME_LIBRARY,
    },
});

export default Library;
