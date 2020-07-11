import { Input, useInput } from "@zeit-ui/react";

import PrimaryButton from "../components/PrimaryButton";
import ButtonGroup from "../components/ButtonGroup";
import PageLayout from "../components/PageLayout";

export const Join = (): JSX.Element => {
    const { state: code, bindings } = useInput("");

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
