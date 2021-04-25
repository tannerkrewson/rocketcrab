import React, { useState } from "react";
import { useRouter } from "next/router";

import PrimaryButton from "../components/common/PrimaryButton";
import ButtonGroup from "../components/common/ButtonGroup";
import AddAppButton from "../components/layout/AddAppButton";
import PageLayout from "../components/layout/PageLayout";
import { postJson } from "../utils/utils";
import { Spacer } from "@geist-ui/react";
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
        <PageLayout center={true} mode={mode}>
            <div className="description">
                {isKidsMode
                    ? "play in class or with family!"
                    : "party games for phones"}
            </div>

            <ButtonGroup>
                <PrimaryButton href="/join" size="large">
                    &nbsp;Join Party&nbsp;
                </PrimaryButton>

                <PrimaryButton
                    onClick={onClickNew}
                    loading={newLoading}
                    size="large"
                >
                    Start Party
                </PrimaryButton>
            </ButtonGroup>
            <Spacer y={1.2} />
            <div className="btn-col">
                {!isAlreadyPWA && !isKidsMode && (
                    <>
                        <AddAppButton />
                        <Spacer y={0.5} />
                    </>
                )}
                {!isKidsMode && (
                    <>
                        <PrimaryButton
                            type="default"
                            url="https://kids.rocketcrab.com/"
                            manualWidth
                        >
                            🧒 Try Kids Mode
                        </PrimaryButton>
                        <Spacer y={0.5} />
                        <PrimaryButton
                            type="default"
                            url="https://discord.gg/MvYRVCP"
                            manualWidth
                        >
                            <img
                                src="/Discord-Logo-Color.svg"
                                className="discord-logo"
                            />
                            Join our Discord
                        </PrimaryButton>
                        <Spacer y={0.5} />
                        <PrimaryButton
                            type="default"
                            url="https://github.com/tannerkrewson/rocketcrab/#-for-developers"
                            manualWidth
                        >
                            Add your game
                        </PrimaryButton>
                        <Spacer y={0.5} />
                    </>
                )}
                <PrimaryButton type="default" href="/library" manualWidth>
                    Browse Games
                </PrimaryButton>
            </div>
            <Spacer y={0.5} />
            <style jsx>{`
                .description {
                    text-align: center;
                    margin-bottom: 2em;
                }
                .discord-logo {
                    width: 1.7em;
                    margin-left: -0.35em;
                    margin-right: 0.3em;
                    margin-bottom: -0.1em;
                }
                .btn-col {
                    display: flex;
                    flex-direction: column;
                    width: fit-content;
                    margin: 0 auto;
                }
            `}</style>
        </PageLayout>
    );
};

export const getStaticProps: GetServerSideProps = async ({ locale }) => ({
    props: {
        mode: locale as RocketcrabMode,
    },
});

export default Home;
