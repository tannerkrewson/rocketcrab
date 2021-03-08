import { GetStaticPaths, GetStaticProps, InferGetStaticPropsType } from "next";
import { useRouter } from "next/router";
import { useCallback } from "react";
import GameDetail from "../../components/detail/GameDetail";
import PrimaryButton from "../../components/common/PrimaryButton";
import ButtonGroup from "../../components/common/ButtonGroup";
import PageLayout from "../../components/layout/PageLayout";
import { RocketcrabMode } from "../../types/enums";
import { GAME_LIBRARY } from "../../config";

export const GamePage = ({
    game,
    allCategories,
    mode,
}: InferGetStaticPropsType<typeof getStaticProps>): JSX.Element => {
    const router = useRouter();
    const onBack = useCallback(() => router.back(), [router]);

    return (
        <PageLayout mode={mode}>
            <GameDetail game={game} allCategories={allCategories} />
            <ButtonGroup>
                <PrimaryButton onClick={onBack}>
                    ↩️ Back to search
                </PrimaryButton>
                <PrimaryButton href={`/transfer/${game.id}/`}>
                    Start Party
                </PrimaryButton>
            </ButtonGroup>
        </PageLayout>
    );
};

export const getStaticProps: GetStaticProps = async ({ params, locale }) => {
    const { gameid } = params;
    const mode = locale as RocketcrabMode;
    const { gameList, categories } = GAME_LIBRARY[mode];
    const game = gameList.find(({ id }) => id === gameid);

    if (!game.showOn.includes(mode)) {
        return {
            notFound: true,
        };
    }

    return {
        props: {
            game,
            allCategories: categories,
            mode,
        },
    };
};

export const getStaticPaths: GetStaticPaths = async () => {
    return {
        paths: getAllPaths(),
        fallback: false,
    };
};

const getAllPaths = () =>
    [RocketcrabMode.MAIN, RocketcrabMode.KIDS]
        .map((mode) =>
            GAME_LIBRARY[mode].gameList.map(({ id }) => ({
                params: { gameid: id },
                locale: mode,
            }))
        )
        .flat();

export default GamePage;
