import { GetStaticPaths, GetStaticProps, InferGetStaticPropsType } from "next";
import { useRouter } from "next/router";
import { useCallback } from "react";
import GameDetailBox from "../../components/library/GameDetailBox";
import PrimaryButton from "../../components/common/PrimaryButton";
import PageLayout from "../../components/layout/PageLayout";
import { getClientGameLibrary } from "../../config";

const CLIENT_GAME_LIBRARY = getClientGameLibrary();

export const GamePage = ({
    game,
    allCategories,
}: InferGetStaticPropsType<typeof getStaticProps>): JSX.Element => {
    const router = useRouter();
    const onBack = useCallback(() => router.back(), [router]);

    return (
        <PageLayout>
            <GameDetailBox game={game} allCategories={allCategories} />
            <PrimaryButton onClick={onBack}>↩️ Back to search</PrimaryButton>
        </PageLayout>
    );
};

export const getStaticProps: GetStaticProps = async (ctx) => {
    const { gameid } = ctx.params;
    const { gameList, categories } = CLIENT_GAME_LIBRARY;

    return {
        props: {
            game: gameList.find(({ id }) => id === gameid),
            allCategories: categories,
        },
    };
};

export const getStaticPaths: GetStaticPaths = async () => {
    const { gameList } = CLIENT_GAME_LIBRARY;
    return {
        paths: gameList.map(({ id }) => ({ params: { gameid: id } })),
        fallback: false,
    };
};

export default GamePage;
