import { ServerGame } from "../../types/types";
import WebSocket from "ws";
import { randomBytes } from "crypto";

const game: ServerGame = {
    id: "insideronline",
    name: "Insider",
    author: "Alenros",
    basedOn: {
        game: "Insider",
        author: "Oink Games",
        link: "https://oinkgames.com/en/games/analog/insider/",
    },
    description:
        '"Insider" combines two fun components: finding out what the secret word is and revealing the Insider. The Insider knows the secret word and tries to hide their identity while carefully manipulating the other players to the right answer.',
    displayUrlText: "insider-online.herokuapp.com",
    displayUrlHref: "https://insider-online.herokuapp.com/",
    category: ["medium"],
    players: "4-8",
    familyFriendly: true,
    getJoinGameUrl: async () => {
        const ws = new WebSocket(
            "wss://insider-online.herokuapp.com/sockjs/rocketcrab/rocketcrab/websocket"
        );

        const accessCode = (
            Math.floor(Math.random() * 90000) + 10000
        ).toString();

        ws.on("open", () => {
            ws.on("message", (msg: string) => {
                if (!msg.startsWith('a["{\\"msg\\":\\"connected\\",')) return;

                const createGamePayload = JSON.stringify({
                    msg: "method",
                    method: "/games/insert",
                    params: [
                        {
                            accessCode,
                            state: "waitingForPlayers",
                            word: null,
                            lengthInMinutes: 5,
                            endTime: null,
                            paused: false,
                            pausedTime: null,
                        },
                    ],
                    id: "3",
                    randomSeed: randomBytes(10).toString("hex"),
                }).replace(/"/g, '\\"');

                ws.send('["' + createGamePayload + '"]');
            });

            ws.send(
                '["{\\"msg\\":\\"connect\\",\\"version\\":\\"1\\",\\"support\\":[\\"1\\",\\"pre2\\",\\"pre1\\"]}"]',
                () => setTimeout(() => ws.close(), 10 * 1000)
            );
        });

        return {
            playerURL: "https://insider-online.herokuapp.com/" + accessCode,
        };
    },
};

export default game;
