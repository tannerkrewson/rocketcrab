import { useRouter } from "next/router";
import { Input } from "@geist-ui/react";

import PrimaryButton from "../components/atoms/PrimaryButton";
import ButtonGroup from "../components/molecules/ButtonGroup";
import PageLayout from "../components/templates/PageLayout";
import { useState } from "react";

export const Join = (): JSX.Element => {
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
        <PageLayout path={code} disablePhonetic={true} center={true}>
            <div className="description">Join Party</div>
            <div className="input-container">
                <Input
                    placeholder="ex. abcd"
                    size="large"
                    width="8rem"
                    clearable={!joinLoading}
                    type="text"
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

export default Join;
