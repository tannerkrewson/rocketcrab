import { Input, useInput } from "@geist-ui/react";
import React, { useEffect, useState } from "react";
import {
    ChatMessage,
    ENABLE_FILTER,
    MAX_CHAT_MSG_LEN,
    MIN_MS_BETWEEN_MSGS,
    Player,
} from "../../types/types";
import { isChatMsgValid } from "../../utils/utils";
import PrimaryButton from "../common/PrimaryButton";
import SkinnyCard from "../common/SkinnyCard";
import Filter from "bad-words";
const filter = new Filter();

export const ChatBox = ({
    chat,
    onSendChat,
    thisPlayer,
}: {
    chat: Array<ChatMessage>;
    onSendChat: (message: string) => void;
    thisPlayer: Player;
}): JSX.Element => {
    const { state: msgToSend, bindings, reset } = useInput("");
    const [showChat, setShowChat] = useState(true);
    const [sendDisabled, setSendDisabled] = useSendButton(
        msgToSend,
        thisPlayer,
        chat
    );

    const handleConfirm = (e?) => {
        if (e) e.preventDefault();
        if (!isChatMsgValid(msgToSend, thisPlayer, chat)) return;

        onSendChat(msgToSend);
        reset();

        setTimeout(setSendDisabled, MIN_MS_BETWEEN_MSGS);
    };

    const onEnter = (e) => {
        if (e.key !== "Enter") return;

        handleConfirm();
    };

    useEffect(setSendDisabled, [msgToSend]);

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
                        {chat.map(({ playerId, playerName, message, date }) => (
                            <div key={date}>
                                <b>{playerName}: </b>
                                {ENABLE_FILTER && playerId !== thisPlayer.id
                                    ? filter.clean(message)
                                    : message}
                            </div>
                        ))}
                    </div>
                    <div className="input-container">
                        <Input
                            {...bindings}
                            autoFocus
                            onKeyDown={onEnter}
                            maxLength={MAX_CHAT_MSG_LEN}
                            width="100%"
                        />
                        <div className="send-container">
                            <PrimaryButton
                                size="small"
                                onClick={handleConfirm}
                                disabled={sendDisabled}
                            >
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

const useSendButton = (
    msgToSend: string,
    thisPlayer: Player,
    chat: Array<ChatMessage>
): [boolean, () => void] => {
    const [sendDisabled, setSendDisabled] = useState(true);

    return [
        sendDisabled,
        () => setSendDisabled(!isChatMsgValid(msgToSend, thisPlayer, chat)),
    ];
};
