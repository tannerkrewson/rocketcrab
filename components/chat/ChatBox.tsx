import { Input, Spacer, useInput } from "@geist-ui/react";
import React, { useEffect, useRef, useState } from "react";
import {
    ChatMessage,
    ENABLE_FILTER,
    MAX_CHAT_MSG_LEN,
    MIN_MS_BETWEEN_MSGS,
    Player,
} from "../../types/types";
import { filterClean, isChatMsgValid } from "../../utils/utils";
import { CollapseBox } from "../common/CollapseBox";
import PrimaryButton from "../common/PrimaryButton";

export const ChatBox = ({
    chat,
    onSendChat,
    thisPlayer,
    disableHideShow = false,
    startHidden = false,
}: {
    chat: Array<ChatMessage>;
    onSendChat: (message: string) => void;
    thisPlayer: Player;
    disableHideShow?: boolean;
    startHidden?: boolean;
}): JSX.Element => {
    const { state: msgToSend, bindings, reset } = useInput("");
    const [isChatShowing, setIsChatShowing] = useState(!startHidden);
    const [sendDisabled, setSendDisabled] = useSendButton(
        msgToSend,
        thisPlayer,
        chat
    );
    const [newMsgCount, setNewMsgCount] = useState(0);
    const messagesEndRef = useRef(null);

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

    useEffect(() => {
        if (isChatShowing && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
            return;
        }
        setNewMsgCount(newMsgCount + 1);
    }, [chat]);

    return (
        <CollapseBox
            title="Chat"
            startHidden={startHidden}
            disableHideShow={disableHideShow}
            badgeCount={newMsgCount}
            onCollapse={(currentCollapse) => {
                setNewMsgCount(0);
                setIsChatShowing(!currentCollapse);
            }}
        >
            <Spacer y={0.5} />
            <div className="msg-container">
                {chat.map(({ playerId, playerName, message, date }) => (
                    <div key={date}>
                        <b>{playerName}: </b>
                        {ENABLE_FILTER && playerId !== thisPlayer.id
                            ? filterClean(message)
                            : message}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            <div className="flex-center-row">
                <Input
                    {...bindings}
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
            <style jsx>{`
                .flex-center-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .send-container {
                    margin-left: 0.5em;
                }
                .msg-container {
                    text-align: left;
                    height: 10em;
                    overflow: auto;
                }
            `}</style>
        </CollapseBox>
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
