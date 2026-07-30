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
    const [msgToSend, setMsgToSend] = useState("");
    const [isChatShowing, setIsChatShowing] = useState(!startHidden);
    const [isChatSendDisabled, setIsChatSendDisabled] = useState(false);

    const messagesEndRef = useRef(null);
    const [isFirstRender, setIsFirstRender] = useState(true);

    const handleConfirm = (e?) => {
        if (e) e.preventDefault();
        if (!isChatMsgValid(msgToSend, thisPlayer, chat)) return;

        onSendChat(msgToSend);
        setMsgToSend("");
        setIsChatSendDisabled(true);

        setTimeout(() => setIsChatSendDisabled(false), MIN_MS_BETWEEN_MSGS);
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
    }, [chat.length, isChatShowing, isFirstRender]);

    useEffect(() => {
        if (isChatShowing) {
            clearUnreadMsgCount();
        }
    }, [unreadMsgCount, isChatShowing, clearUnreadMsgCount]);

    return (
        <CollapseBox
            title="Chat"
            startHidden={startHidden}
            disableHideShow={disableHideShow}
            badgeCount={unreadMsgCount}
            onCollapse={(currentCollapse) => setIsChatShowing(!currentCollapse)}
            badgeType="danger" // red
        >
            <div className="h-2"></div>
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
                <input
                    className="h-12 w-full border rounded-lg px-3"
                    onKeyDown={onEnter}
                    maxLength={MAX_CHAT_MSG_LEN}
                    value={msgToSend}
                    onChange={(e) => setMsgToSend(e.target.value)}
                />
                <div className="send-container">
                    <PrimaryButton
                        onClick={handleConfirm}
                        disabled={isChatSendDisabled || !msgToSend.length}
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
