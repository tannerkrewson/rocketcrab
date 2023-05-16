import { useRouter } from "next/router";
import { Input } from "@geist-ui/react";

import PrimaryButton from "../components/common/PrimaryButton";
import ButtonGroup from "../components/common/ButtonGroup";
import PageLayout from "../components/layout/PageLayout";
import { useState } from "react";
import { GetServerSideProps } from "next";
import { RocketcrabMode } from "../types/enums";

export const Join = ({ mode }: { mode: RocketcrabMode }): JSX.Element => {
    const router = useRouter();
    const { invalid } = router.query;

    const [joinLoading, setJoinLoading] = useState(false);
    const { code, bindings } = useCodeInput("");

    const onKey = (e) => {
        // if they entered anything but a letter
        if (/[^A-Za-z]/g.test(e.key)) {
            e.preventDefault();
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
        <PageLayout
            path={code}
            disablePhonetic={true}
            center={true}
            mode={mode}
        >
            <div className="description">Join Party</div>
            <div className="input-container">
                <Input
                    placeholder="ex. abcd"
                    scale={4 / 3}
                    width="8rem"
                    clearable={!joinLoading}
                    maxLength={4}
                    autoFocus
                    onKeyDown={onKey}
                    autoCorrect="off"
                    autoCapitalize="none"
                    disabled={joinLoading}
                    {...bindings}
                />
            </div>
            {invalid && (
                <div className="description" style={{ color: "red" }}>
                    {invalid} does not exist 😞
                </div>
            )}
            <ButtonGroup>
                <PrimaryButton href="/" size="large">
                    Back
                </PrimaryButton>

                <PrimaryButton
                    onClick={onJoin}
                    size="large"
                    disabled={code.length !== 4}
                    loading={joinLoading}
                >
                    Join
                </PrimaryButton>
            </ButtonGroup>
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
