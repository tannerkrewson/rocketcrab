import { Input, useInput } from "@geist-ui/react";
import React, { useState } from "react";
import { ChatMessage } from "../../types/types";
import PrimaryButton from "../common/PrimaryButton";
import SkinnyCard from "../common/SkinnyCard";

export const ChatBox = ({
    chat,
}: {
    chat: Array<ChatMessage>;
}): JSX.Element => {
    const { state: msgToSend, bindings, reset } = useInput("");
    const [showChat, setShowChat] = useState(true);

    const handleConfirm = (e?) => {
        if (e) e.preventDefault();
        if (msgToSend.length < 1) return;

        //onMsgSend(msgToSend);
        //console.log("sending", msgToSend);
        reset();
    };

    const onEnter = (e) => {
        if (e.key !== "Enter") return;

        handleConfirm();
    };
    return (
        <SkinnyCard>
            <div className="input-container">
                <h4>Chat</h4>
                <PrimaryButton
                    size="mini"
                    onClick={() => setShowChat(!showChat)}
                >
                    {showChat ? "▲ Hide" : "▼ Show"}
                </PrimaryButton>
            </div>
            {showChat && (
                <>
                    <div className="msg-container">
                        {chat.map(({ playerName, message, date }) => (
                            <div key={date}>
                                <b>{playerName}: </b>
                                {message}
                            </div>
                        ))}
                    </div>
                    <div className="input-container">
                        <Input
                            {...bindings}
                            autoFocus
                            onKeyDown={onEnter}
                            maxLength={280}
                            width="100%"
                        />
                        <div className="send-container">
                            <PrimaryButton size="small" onClick={handleConfirm}>
                                Send
                            </PrimaryButton>
                        </div>
                    </div>
                </>
            )}

            <style jsx>{`
                .input-container {
                    display: flex;
                    justify-content: space-between;
                }
                .send-container {
                    margin-top: 0.1em;
                    margin-left: 0.5em;
                }
                .msg-container {
                    text-align: left;
                }
            `}</style>
        </SkinnyCard>
    );
};
