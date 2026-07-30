import React, { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import PrimaryButton from "../common/PrimaryButton";

const NameEntry = ({
    onNameEntry,
    previousName,
}: NameEntryProps): JSX.Element => {
    const navigate = useNavigate();
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
            navigate({ to: "/" });
        }
    };

    const onEnter = (e) => {
        if (e.key !== "Enter") return;

        handleConfirm();
    };

    return (
        <>
            <div className="flex flex-col gap-1">
                <label htmlFor="player-name" className="text-sm font-medium">
                    Enter your name:
                </label>
                <input
                    id="player-name"
                    placeholder="Use your real name!"
                    value={name}
                    onChange={handleNameChange}
                    autoFocus
                    onKeyDown={onEnter}
                    maxLength={24}
                    className="border rounded-lg px-3 py-2"
                />
            </div>

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
