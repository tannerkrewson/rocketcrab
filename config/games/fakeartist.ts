import { ServerGame } from "../../types/types";
import WebSocket from "ws";
import { randomBytes } from "crypto";

const game: ServerGame = {
    id: "fakeartist",
    name: "A Fake Artist Goes To New York",
    author: "Alenros",
    basedOn: {
        game: "A Fake Artist Goes To New York",
        author: "Oink Games",
        link:
            "https://oinkgames.com/en/games/analog/a-fake-artist-goes-to-new-york/",
    },
    description:
        "Everyone is drawing one picture together...and one doesn't even know what they draw. There is a Fake Artist hiding among the real artists - can you find out who it is? The Fake Artist has to be careful not to be give himself away and guess what is being drawn while the real artists have to signal the other artists with their drawing that they know the word, without making the drawing too obvious for the Fake Artist. The catch? you only get to draw one line.",
    displayUrlText: "fake-artist.herokuapp.com",
    displayUrlHref: "https://fake-artist.herokuapp.com/",
    category: ["medium","drawing"],
    players: "4-10",
    familyFriendly: true,
    getJoinGameUrl: async () => {
        const ws = new WebSocket(
            "wss://fake-artist.herokuapp.com/sockjs/rocketcrab/rocketcrab/websocket"
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
            playerURL: "https://fake-artist.herokuapp.com/" + accessCode,
        };
    },
};

export default game;
