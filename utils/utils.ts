import {
    ChatMessage,
    LibraryState,
    MAX_CHAT_MSG_LEN,
    MIN_MS_BETWEEN_MSGS,
    Player,
    PromiseWebSocket,
} from "../types/types";
import WebSocket from "ws";
import { useState } from "react";
import Filter from "bad-words";

const filter = new Filter();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const postJson = (url = "", data = {}): Promise<any> =>
    fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    }).then((res) => res.json());

export const newPromiseWebSocket = (url: string): PromiseWebSocket => {
    const ws = new WebSocket(url) as PromiseWebSocket;

    ws.onOpen = () => new Promise((resolve) => ws.on("open", () => resolve()));

    ws.onMessage = () =>
        new Promise((resolve) =>
            ws.on("message", (msg) => resolve(msg as unknown as string)),
        );

    ws.untilMessage = (msgChecker) =>
        new Promise((resolve, reject) =>
            ws.on("message", (msg) => {
                try {
                    if (msgChecker(msg as unknown as string)) {
                        resolve(msg as unknown as string);
                    }
                } catch (error) {
                    ws.close();
                    reject(error);
                }
            }),
        );

    return ws;
};

export const useLibraryState = (): LibraryState => {
    const [selectedCategory, setSelectedCategory] = useState("");
    const [search, setSearch] = useState("");

    return {
        selectedCategory,
        setSelectedCategory,
        search,
        setSearch,
    };
};

export const isChatMsgValid = (
    message: string,
    player: Player,
    chat: Array<ChatMessage>,
): boolean => {
    if (
        typeof message !== "string" ||
        message.length > MAX_CHAT_MSG_LEN ||
        message.length < 1
    ) {
        return false;
    }

    const now = Date.now().valueOf();

    const indexOfLatestMsgFromThisPlayer = chat
        .map(({ playerId }) => playerId === player.id)
        .lastIndexOf(true);

    if (indexOfLatestMsgFromThisPlayer === -1) return true;

    const latestMsgFromThisPlayer = chat[indexOfLatestMsgFromThisPlayer];

    const timeBetweenLastMsgAndNow = now - latestMsgFromThisPlayer.date;

    return timeBetweenLastMsgAndNow >= MIN_MS_BETWEEN_MSGS;
};

// https://github.com/web-mech/badwords/issues/93
export const filterClean = (message: string): string => {
    try {
        return filter.clean(message);
        // eslint-disable-next-line no-empty
    } catch (e) {}

    return message;
};

// Mode resolution — see utils/mode.ts for the canonical implementation
export { MODE_MAP, getModeFromHost, isKidsMode } from "./mode";
// Mode context (JSX) available from ./ModeContext

