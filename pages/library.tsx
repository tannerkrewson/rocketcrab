import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import React, { useCallback } from "react";
import GameLibrary from "../components/library/GameLibrary";
import PageLayout from "../components/layout/PageLayout";
import { ClientGameLibrary } from "../types/types";
import { MODE_MAP, useLibraryState } from "../utils/utils";
import { RocketcrabMode } from "../types/enums";
import { GAME_LIBRARY } from "../config";

export const Library = ({ gameLibrary, mode }: LibraryProps): JSX.Element => {
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
        <PageLayout mode={mode}>
            <GameLibrary
                gameLibrary={gameLibrary}
                backToLabel={MODE_MAP[mode]}
                onDone={onDone}
                setViewingGameId={onViewGame}
                libraryState={libraryState}
            />
        </PageLayout>
    );
};

type LibraryProps = {
    gameLibrary: ClientGameLibrary;
    mode: RocketcrabMode;
};

export const getStaticProps: GetServerSideProps = async ({ locale }) => ({
    props: {
        gameLibrary: GAME_LIBRARY[locale as RocketcrabMode],
        mode: locale as RocketcrabMode,
    },
});

export default Library;
