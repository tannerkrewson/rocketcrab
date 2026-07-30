import React, { useState } from "react";
import { useRouter } from "next/router";

import PrimaryButton from "../components/common/PrimaryButton";
import AddAppButton from "../components/layout/AddAppButton";
import PageLayout from "../components/layout/PageLayout";
import { postJson } from "../utils/utils";

import { useIsAlreadyPWA } from "../utils/useIsAlreadyPWA";
import { RocketcrabMode } from "../types/enums";
import { GetServerSideProps } from "next";

export const Home = ({ mode }: { mode: RocketcrabMode }): JSX.Element => {
    const router = useRouter();
    const isKidsMode = router.locale === RocketcrabMode.KIDS;
    const [newLoading, setNewLoading] = useState(false);
    const isAlreadyPWA = useIsAlreadyPWA();

    const onClickNew = async (e) => {
        e.preventDefault();
        setNewLoading(true);

        const { code } = await postJson("/api/new");

        router.push("/" + code);
    };

    return (
        <PageLayout mode={mode}>
            <div className="text-center mb-8">
                {isKidsMode
                    ? "play in class or with family!"
                    : "party games for phones"}
            </div>

            <div className="flex justify-center space-x-2">
                <PrimaryButton href="/join" size="lg">
                    &nbsp;Join Party&nbsp;
                </PrimaryButton>

                <PrimaryButton
                    onClick={onClickNew}
                    loading={newLoading}
                    size="lg"
                >
                    Start Party
                </PrimaryButton>
            </div>
            <div className="h-32"></div>
            <div className="flex flex-col w-fit mx-auto space-y-2">
                {!isAlreadyPWA && !isKidsMode && (
                    <>
                        <AddAppButton />
                    </>
                )}
                {!isKidsMode && (
                    <>
                        <PrimaryButton
                            url="https://kids.rocketcrab.com/"
                            manualWidth
                        >
                            🧒 Try Kids Mode
                        </PrimaryButton>
                        <PrimaryButton
                            url="https://github.com/tannerkrewson/rocketcrab/#-for-developers"
                            manualWidth
                        >
                            Add your game
                        </PrimaryButton>
                    </>
                )}
                <PrimaryButton href="/library" manualWidth>
                    Browse Games
                </PrimaryButton>
            </div>
            <div className="h-2"></div>
        </PageLayout>
    );
};

export const getStaticProps: GetServerSideProps = async ({ locale }) => ({
    props: {
        mode: locale as RocketcrabMode,
    },
});

export default Home;
