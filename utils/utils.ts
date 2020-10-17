import { LibraryState, PromiseWebSocket } from "../types/types";
import WebSocket from "ws";
import { useInput } from "@geist-ui/react";
import { useState } from "react";

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
