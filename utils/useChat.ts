import { useCallback, useEffect, useState } from "react";
import { ChatMessage, Player } from "../types/types";

export const useChat = (
    chat: Array<ChatMessage>,
    me: Player
): {
    unreadMsgCount: number;
    clearUnreadMsgCount: () => void;
    newestMsg: ChatMessage;
} => {
    const [unreadMsgCount, setUnreadMsgCount] = useState(chat?.length ?? 0);
    const [previousLastMsg, setPreviousLastMsg] = useState(
        chat?.length && chat[chat.length - 1]
    );

    useEffect(() => {
        if (!chat?.length) return;

        const nextLastMsg = chat[chat.length - 1];

        // don't notify if this msg was sent by this client
        if (nextLastMsg.playerId === me.id) return;

        // if the new newest msg is not the same as the last newest msg
        if (!previousLastMsg || nextLastMsg.date > previousLastMsg.date) {
            setUnreadMsgCount(unreadMsgCount + 1);
            setPreviousLastMsg(nextLastMsg);
        }
    }, [chat]);

    return {
        unreadMsgCount,
        clearUnreadMsgCount: useCallback(() => setUnreadMsgCount(0), []),
        newestMsg: previousLastMsg,
    };
};
