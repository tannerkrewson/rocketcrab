import { useState } from "react";
import { useRouter } from "next/router";

import PrimaryButton from "../components/atoms/PrimaryButton";
import ButtonGroup from "../components/molecules/ButtonGroup";
import PageLayout from "../components/organisms/PageLayout";
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
            <div className="description">
                all the best mobile web party games
            </div>

            <ButtonGroup>
                <PrimaryButton href="/join">Join Lobby</PrimaryButton>

                <PrimaryButton onClick={onClickNew} loading={newLoading}>
                    New Lobby
                </PrimaryButton>
            </ButtonGroup>
            <style jsx>{`
                .description {
                    text-align: center;
                    margin-bottom: 2em;
                }
            `}</style>
        </PageLayout>
    );
};

export default Home;
