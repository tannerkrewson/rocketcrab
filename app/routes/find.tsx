import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMode } from "../../utils/ModeContext";
import { isKidsMode } from "../../utils/mode";
import { RocketcrabMode } from "../../types/enums";
import PageLayout from "../../components/layout/PageLayout";
import PrimaryButton from "../../components/common/PrimaryButton";

export const Route = createFileRoute("/find")({
    component: FindComponent,
});

function FindComponent() {
    const mode = useMode();

    // Unavailable in KIDS mode
    if (isKidsMode(mode)) {
        return (
            <PageLayout mode={RocketcrabMode.KIDS}>
                <div className="text-center py-12">
                    <h1 className="text-2xl font-bold mb-4">
                        Not Available
                    </h1>
                    <p className="mb-4">
                        Public parties are not available in Kids Mode.
                    </p>
                    <PrimaryButton href="/">Back Home</PrimaryButton>
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout mode={mode}>
            <div className="text-center py-12">
                <h1 className="text-2xl font-bold mb-4">
                    Public Parties
                </h1>
                <p className="mb-4">
                    The public party finder is no longer available.
                </p>
                <p className="mb-8 text-gray-600 dark:text-gray-400">
                    You can still start a private party and share the code
                    with friends!
                </p>
                <div className="flex justify-center space-x-2">
                    <PrimaryButton href="/">Back Home</PrimaryButton>
                </div>
            </div>
        </PageLayout>
    );
}
