import { Input, Spacer, useInput } from "@geist-ui/react";
import React, { useEffect, useRef, useState } from "react";
import {
    ChatMessage,
    ENABLE_FILTER,
    MAX_CHAT_MSG_LEN,
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
    unreadMsgCount,
    clearUnreadMsgCount,
}: {
    chat: Array<ChatMessage>;
    onSendChat: (message: string) => void;
    thisPlayer: Player;
    disableHideShow?: boolean;
    startHidden?: boolean;
    unreadMsgCount: number;
    clearUnreadMsgCount: () => void;
}): JSX.Element => {
    const { state: msgToSend, bindings, reset } = useInput("");
    const [isChatShowing, setIsChatShowing] = useState(!startHidden);

    const messagesEndRef = useRef(null);
    const [isFirstRender, setIsFirstRender] = useState(true);

    const handleConfirm = (e?) => {
        if (e) e.preventDefault();
        if (!isChatMsgValid(msgToSend, thisPlayer, chat)) return;

        onSendChat(msgToSend);
        reset();
    };

    const onEnter = (e) => {
        if (e.key !== "Enter") return;

        handleConfirm();
    };

    useEffect(() => {
        if (!isFirstRender && isChatShowing && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
            return;
        }
        setIsFirstRender(false);
        // the isFirstRender check prevents the page from scrolling to the chat
        // box when first entering the party screen, after selecting a game, etc.
    }, [chat.length]);

    useEffect(() => {
        if (isChatShowing) {
            clearUnreadMsgCount();
        }
    }, [unreadMsgCount, isChatShowing]);

    return (
        <CollapseBox
            title="Chat"
            startHidden={startHidden}
            disableHideShow={disableHideShow}
            badgeCount={unreadMsgCount}
            onCollapse={(currentCollapse) => setIsChatShowing(!currentCollapse)}
            badgeType="error" // red
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
                    <PrimaryButton size="small" onClick={handleConfirm}>
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
