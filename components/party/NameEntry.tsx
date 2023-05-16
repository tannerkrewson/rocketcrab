import React, { useState } from "react";
import Router from "next/router";
import { Input } from "@geist-ui/react";
import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";

const NameEntry = ({
    onNameEntry,
    previousName,
}: NameEntryProps): JSX.Element => {
    const [name, setName] = useState("");

    const handleNameChange = ({ target: { value } }) => setName(value);

    const handleConfirm = (e?) => {
        if (e) e.preventDefault();
        if (name.length < 1) return;

        onNameEntry(name);
    };

    const handleBack = (e) => {
        e.preventDefault();

        if (previousName) {
            onNameEntry(previousName);
        } else {
            Router.push("/");
        }
    };

    const onEnter = (e) => {
        if (e.key !== "Enter") return;

        handleConfirm();
    };

    return (
        <>
            <div className="description">Enter your name:</div>
            <div className="input-container">
                <Input
                    id="player-name"
                    placeholder="Use your real name!"
                    value={name}
                    onChange={handleNameChange}
                    autoFocus
                    onKeyDown={onEnter}
                    maxLength={24}
                    scale={4 / 3}
                    clearable
                />
            </div>

            <ButtonGroup>
                <PrimaryButton onClick={handleBack} size="large">
                    Back
                </PrimaryButton>

                <PrimaryButton
                    onClick={handleConfirm}
                    disabled={name.length < 1}
                    size="large"
                >
                    Confirm
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
        </>
    );
};

type NameEntryProps = {
    onNameEntry: (name: string) => any;
    previousName: string;
};

export default NameEntry;
