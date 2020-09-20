import React, { useState } from "react";
import { useRouter } from "next/router";

import PrimaryButton from "../components/atoms/PrimaryButton";
import ButtonGroup from "../components/molecules/ButtonGroup";
import PageLayout from "../components/templates/PageLayout";
import { postJson } from "../utils/utils";
import Link from "next/link";
import { Spacer } from "@geist-ui/react";

export const Home = (): JSX.Element => {
    const router = useRouter();
    const [newLoading, setNewLoading] = useState(false);

    const onClickNew = async (e) => {
        e.preventDefault();
        setNewLoading(true);

        const { code } = await postJson("/api/new");

        router.push("/" + code);
    };

    return (
        <PageLayout>
            <div className="description">party games for phones</div>

            <ButtonGroup>
                <PrimaryButton href="/join" size="large">
                    Join Party
                </PrimaryButton>

                <PrimaryButton
                    onClick={onClickNew}
                    loading={newLoading}
                    size="large"
                >
                    New Party
                </PrimaryButton>
            </ButtonGroup>
            <Spacer y={0.5} />
            <div className="links">
                <a
                    href="https://discord.gg/MvYRVCP"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link"
                >
                    Discord
                </a>
                <span className="spacer">|</span>
                <a
                    href="https://github.com/tannerkrewson/rocketcrab/#-for-developers"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link"
                >
                    Developers
                </a>
                <span className="spacer">|</span>
                <span className="link">
                    <Link href="/library">Browse Games</Link>
                </span>
            </div>
            <style jsx>{`
                .description {
                    text-align: center;
                    margin-bottom: 2em;
                }
                .links {
                    margin-top: 1.5em;
                    display: flex;
                    justify-content: center;
                }
                .links .link {
                    display: inline-block;
                    margin: 0 0.5em;
                    font-size: 12px;
                }
                .links .link:hover {
                    text-decoration: underline;
                }
                .links .spacer {
                    line-height: 1em;
                    color: grey;
                }
            `}</style>
        </PageLayout>
    );
};

export default Home;
