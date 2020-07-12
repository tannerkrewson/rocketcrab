import { useRouter } from "next/router";
import { Input, useInput } from "@zeit-ui/react";

import PrimaryButton from "../components/atoms/PrimaryButton";
import ButtonGroup from "../components/molecules/ButtonGroup";
import PageLayout from "../components/templates/PageLayout";

export const Join = (): JSX.Element => {
    const router = useRouter();
    const { state: code, bindings } = useInput("");

    const onEnter = (e) => {
        if (e.key !== "Enter") return;

        router.push("/[code]", "/" + code);
    };

    return (
        <PageLayout path={code}>
            <div className="description">Join Lobby</div>
            <div className="input-container">
                <Input
                    placeholder="ex. abcd"
                    size="large"
                    width="8rem"
                    clearable
                    maxLength={4}
                    autoFocus
                    onKeyDown={onEnter}
                    {...bindings}
                />
            </div>

            <ButtonGroup>
                <PrimaryButton href="/">Back</PrimaryButton>

                <PrimaryButton href="/[code]" as={"/" + code}>
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

export default Join;
