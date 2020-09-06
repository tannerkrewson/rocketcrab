import { useState } from "react";
import { useRouter } from "next/router";

import PrimaryButton from "../components/atoms/PrimaryButton";
import ButtonGroup from "../components/molecules/ButtonGroup";
import PageLayout from "../components/templates/PageLayout";
import { postJson } from "../utils/utils";

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
                    Join Lobby
                </PrimaryButton>

                <PrimaryButton
                    onClick={onClickNew}
                    loading={newLoading}
                    size="large"
                >
                    New Lobby
                </PrimaryButton>
            </ButtonGroup>
            <div className="links">
                <a
                    href="https://discord.gg/MvYRVCP"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Discord
                </a>
                <span>|</span>
                <a
                    href="https://github.com/tannerkrewson/rocketcrab/#-for-developers"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Developers
                </a>
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
                .links a {
                    display: inline-block;
                    margin: 0 0.5em;
                    font-size: 12px;
                }
                .links a:hover {
                    text-decoration: underline;
                }
                .links span {
                    line-height: 1em;
                    color: grey;
                }
            `}</style>
        </PageLayout>
    );
};

export default Home;
