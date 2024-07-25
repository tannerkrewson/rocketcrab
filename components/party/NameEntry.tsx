import React, { useState } from "react";
import Router from "next/router";
import { Input } from "@nextui-org/react";
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
            <Input
                id="player-name"
                label="Enter your name:"
                placeholder="Use your real name!"
                value={name}
                onChange={handleNameChange}
                autoFocus
                onKeyDown={onEnter}
                maxLength={24}
            />

            <div className="flex mt-4 justify-center space-x-2">
                <PrimaryButton onClick={handleBack} size="lg">
                    Back
                </PrimaryButton>

                <PrimaryButton
                    onClick={handleConfirm}
                    disabled={name.length < 1}
                    size="lg"
                >
                    Confirm
                </PrimaryButton>
            </div>
        </>
    );
};

type NameEntryProps = {
    onNameEntry: (name: string) => void;
    previousName: string;
};

export default NameEntry;
