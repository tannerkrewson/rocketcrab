import React, { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Input } from "@heroui/react";

import PrimaryButton from "../../components/common/PrimaryButton";
import PageLayout from "../../components/layout/PageLayout";
import { useMode } from "../../utils/ModeContext";

/**
 * Join route — four-letter party code validation and navigation.
 *
 * Query params:
 *   ?invalid=<code> — shown as an error message when the target party
 *     does not exist (set by the invalid-party server redirect).
 */
export const Route = createFileRoute("/join")({
    component: JoinComponent,
    validateSearch: (search: Record<string, unknown>) => ({
        invalid:
            typeof search.invalid === "string" ? search.invalid : undefined,
    }),
});

function JoinComponent() {
    const navigate = useNavigate();
    const { invalid } = Route.useSearch();
    const mode = useMode();

    const [joinLoading, setJoinLoading] = useState(false);
    const { code, bindings } = useCodeInput("");
    const [hasStartedTyping, setHasStartedTyping] = useState(false);

    const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // if they entered anything but a letter
        if (/[^A-Za-z]/g.test(e.key)) {
            e.preventDefault();
        } else {
            setHasStartedTyping(true);
        }

        if (e.key === "Enter") {
            onJoin();
        }
    };

    const onJoin = () => {
        setJoinLoading(true);
        navigate({ to: `/${code}` });
    };

    return (
        <PageLayout path={code} disablePhonetic={true} mode={mode}>
            <div className="flex justify-center">
                <Input
                    className="w-32"
                    classNames={{
                        label: "static pt-1 pb-1",
                        input: "font-mono text-3xl text-center",
                        inputWrapper: "h-auto",
                    }}
                    size="lg"
                    label="Join Party"
                    placeholder="abcd"
                    maxLength={4}
                    autoFocus
                    onKeyDown={onKey}
                    autoCorrect="off"
                    autoCapitalize="none"
                    disabled={joinLoading}
                    errorMessage={`${invalid} does not exist 😞`}
                    isInvalid={Boolean(invalid) && !hasStartedTyping}
                    spellCheck={false}
                    {...bindings}
                />
            </div>

            <div className="flex mt-4 justify-center space-x-2">
                <Link to="/">
                    <PrimaryButton size="lg">Back</PrimaryButton>
                </Link>

                <PrimaryButton
                    onClick={onJoin}
                    size="lg"
                    disabled={code.length !== 4}
                    loading={joinLoading}
                >
                    Join
                </PrimaryButton>
            </div>

            <p className="text-center mt-4 text-sm text-gray-500">
                Enter a four-letter party code to join a game.
            </p>
        </PageLayout>
    );
}

/**
 * Restricted code input hook — only allows lowercase a-z, max 4 chars.
 */
const useCodeInput = (initialCode: string) => {
    const [code, setCode] = useState(initialCode);

    const restrictedSetCode = (newCode: string): void =>
        setCode(newCode.toLowerCase().substring(0, 4));

    return {
        code,
        setCode: restrictedSetCode,
        bindings: {
            value: code,
            onChange: ({
                target: { value },
            }: React.ChangeEvent<HTMLInputElement>) => restrictedSetCode(value),
        },
    };
};
