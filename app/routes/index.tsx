import React, { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import PrimaryButton from "../../components/common/PrimaryButton";
import AddAppButton from "../../components/layout/AddAppButton";
import PageLayout from "../../components/layout/PageLayout";
import { postJson } from "../../utils/utils";
import { useMode } from "../../utils/ModeContext";
import { isKidsMode } from "../../utils/mode";
import { useIsAlreadyPWA } from "../../utils/useIsAlreadyPWA";

export const Route = createFileRoute("/")({
    component: HomeComponent,
});

function HomeComponent() {
    const navigate = useNavigate();
    const mode = useMode();
    const kids = isKidsMode(mode);
    const [newLoading, setNewLoading] = useState(false);
    const isAlreadyPWA = useIsAlreadyPWA();

    const onClickNew = async (e: React.MouseEvent) => {
        e.preventDefault();
        setNewLoading(true);

        try {
            const { code } = await postJson("/api/new");
            navigate({ to: `/${code}` });
        } catch {
            setNewLoading(false);
        }
    };

    return (
        <PageLayout mode={mode}>
            <div className="text-center mb-8">
                {kids
                    ? "play in class or with family!"
                    : "party games for phones"}
            </div>

            <div className="flex justify-center space-x-2">
                <PrimaryButton
                    onClick={() => navigate({ to: "/join" })}
                    size="lg"
                >
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
            <div className="mt-8" />
            <div className="flex flex-col items-center space-y-2 w-fit mx-auto">
                {!isAlreadyPWA && !kids && (
                    <>
                        <AddAppButton />
                    </>
                )}
                {!kids && (
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
                <PrimaryButton
                    onClick={() => navigate({ to: "/library" })}
                    manualWidth
                >
                    Browse Games
                </PrimaryButton>
            </div>
            <div className="mb-2" />
        </PageLayout>
    );
}
