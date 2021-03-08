import {
    ChatMessage,
    LibraryState,
    MAX_CHAT_MSG_LEN,
    MIN_MS_BETWEEN_MSGS,
    Player,
    PromiseWebSocket,
} from "../types/types";
import WebSocket from "ws";
import { useInput } from "@geist-ui/react";
import { useState } from "react";
import Filter from "bad-words";
import { RocketcrabMode } from "../types/enums";

const filter = new Filter();

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
            ws.on("message", (msg) => resolve(msg as string))
        );

    ws.untilMessage = (msgChecker) =>
        new Promise((resolve, reject) =>
            ws.on("message", (msg) => {
                try {
                    if (msgChecker(msg as string)) {
                        resolve(msg as string);
                    }
                } catch (error) {
                    ws.close();
                    reject(error);
                }
            })
        );

    return ws;
};

export const useLibraryState = (): LibraryState => {
    const [selectedCategory, setSelectedCategory] = useState("");
    const {
        state: search,
        setState: setSearch,
        bindings: searchBindings,
    } = useInput("");

    return {
        selectedCategory,
        setSelectedCategory,
        search,
        setSearch,
        searchBindings,
    };
};

export const isChatMsgValid = (
    message: string,
    player: Player,
    chat: Array<ChatMessage>
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

export const MODE_MAP = {
    [RocketcrabMode.MAIN]: "rocketcrab.com",
    [RocketcrabMode.KIDS]: "kids.rocketcrab.com",
};
