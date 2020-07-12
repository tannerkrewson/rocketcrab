import React, { useState, useEffect } from "react";
import Router from "next/router";
import { Input } from "@zeit-ui/react";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "../molecules/ButtonGroup";

const NameEntry = ({ onNameEntry, code, socket }) => {
    const [name, setName] = useState("");

    // if dev game, pick random name and submit
    useEffect(() => {
        if (code === "ffff") {
            const randFourDig = Math.floor(1000 + Math.random() * 9000);
            onNameEntry(String(randFourDig));
        }
    }, []);

    const handleNameChange = ({ target: { value } }) => setName(value);
    const handleJoin = (e?) => {
        if (e) e.preventDefault();
        onNameEntry(name);
    };

    const handleBack = (e) => {
        e.preventDefault();

        //prevents a redirect back to /[code]
        socket.off("disconnect");

        Router.push("/");
    };

    const onEnter = (e) => {
        if (e.key !== "Enter") return;

        handleJoin();
    };

    return (
        <>
            <div className="description">Enter your name:</div>
            <div className="input-container">
                <Input
                    type="text"
                    id="player-name"
                    placeholder="Use your real name!"
                    value={name}
                    onChange={handleNameChange}
                    autoFocus
                    onKeyDown={onEnter}
                    maxLength={24}
                    size="large"
                    clearable
                />
            </div>

            <ButtonGroup>
                <PrimaryButton onClick={handleBack} size="large">
                    Back
                </PrimaryButton>

                <PrimaryButton onClick={handleJoin} size="large">
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

export default NameEntry;
