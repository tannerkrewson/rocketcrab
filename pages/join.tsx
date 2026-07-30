import { useRouter } from "next/router";

import PrimaryButton from "../components/common/PrimaryButton";
import PageLayout from "../components/layout/PageLayout";
import { useState } from "react";
import { GetServerSideProps } from "next";
import { RocketcrabMode } from "../types/enums";

export const Join = ({ mode }: { mode: RocketcrabMode }): JSX.Element => {
    const router = useRouter();
    const { invalid } = router.query;

    const [joinLoading, setJoinLoading] = useState(false);
    const { code, bindings } = useCodeInput("");
    const [hasStartedTyping, setHasStartedTyping] = useState(false);

    const onKey = (e) => {
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
        router.push("/[code]", "/" + code);
    };

    return (
        <PageLayout path={code} disablePhonetic={true} mode={mode}>
            <div className="flex justify-center">
                <div className="flex flex-col items-center gap-2">
                    <label className="text-sm font-medium">Join Party</label>
                    <input
                        placeholder="abcd"
                        maxLength={4}
                        disabled={joinLoading}
                        autoFocus
                        onKeyDown={onKey}
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        className="w-32 font-mono text-3xl text-center border rounded-lg px-3 py-2"
                        {...bindings}
                    />
                    {invalid && !hasStartedTyping && (
                        <p className="text-sm text-red-500">
                            {invalid} does not exist 😞
                        </p>
                    )}
                </div>
            </div>

            <div className="flex mt-4 justify-center space-x-2">
                <PrimaryButton href="/" size="lg">
                    Back
                </PrimaryButton>

                <PrimaryButton
                    onClick={onJoin}
                    size="lg"
                    disabled={code.length !== 4}
                    loading={joinLoading}
                >
                    Join
                </PrimaryButton>
            </div>
            <style jsx>{`
                .description {
                    text-align: center;
                    margin-bottom: 1em;
                }
                .input-container {
                    margin-bottom: 2em;
                    text-align: center;
                }
            `}</style>
        </PageLayout>
    );
};

const useCodeInput = (initialCode) => {
    const [code, setCode] = useState(initialCode);

    const restrictedSetCode = (newCode: string): void =>
        setCode(newCode.toLowerCase().substring(0, 4));

    return {
        code,
        setCode: restrictedSetCode,
        bindings: {
            value: code,
            onChange: ({ target: { value } }) => restrictedSetCode(value),
        },
    };
};

export const getStaticProps: GetServerSideProps = async ({ locale }) => ({
    props: {
        mode: locale as RocketcrabMode,
    },
});

export default Join;
