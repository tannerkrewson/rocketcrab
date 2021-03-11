import { ServerGame } from "../../types/types";
import { randomBytes } from "crypto";
import { newPromiseWebSocket } from "../../utils/utils";
import { RocketcrabMode } from "../../types/enums";

const connectToGame = (wsUrl, baseUrl) => async () => {
    const ws = newPromiseWebSocket(wsUrl);

    // random 5-digit number
    const accessCode = (Math.floor(Math.random() * 90000) + 10000).toString();

    await ws.onOpen();

    ws.send(
        '["{\\"msg\\":\\"connect\\",\\"version\\":\\"1\\",\\"support\\":[\\"1\\",\\"pre2\\",\\"pre1\\"]}"]'
    );

    await ws.untilMessage((msg) =>
        msg.startsWith('a["{\\"msg\\":\\"connected\\",')
    );

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

    await ws.onMessage();
    ws.close();

    return {
        player: { url: baseUrl + accessCode },
    };
};

const game: Array<ServerGame> = [
    {
        id: "fakeartist",
        name: "A Fake Artist Goes To New York",
        author: "Alenros",
        basedOn: {
            game: "A Fake Artist Goes To New York",
            author: "Oink Games",
            link:
                "https://oinkgames.com/en/games/analog/a-fake-artist-goes-to-new-york/",
        },
        description: `Please note: you will need a way for all players to draw 
            together; it is not provided by the game.

            Everyone is drawing one picture together...and one 
            doesn't even know what they draw. There is a Fake Artist hiding 
            among the real artists - can you find out who it is? The Fake 
            Artist has to be careful not to be give himself away and guess what 
            is being drawn while the real artists have to signal the other 
            artists with their drawing that they know the word, without making 
            the drawing too obvious for the Fake Artist. The catch? you only 
            get to draw one line.`,
        displayUrlText: "fake-artist.herokuapp.com",
        displayUrlHref: "https://fake-artist.herokuapp.com/",
        category: ["medium", "drawing"],
        players: "4-10",
        showOn: [RocketcrabMode.MAIN],
        guideUrl:
            "https://www.ultraboardgames.com/a-fake-artist-goes-to-new-york/game-rules.php",
        pictures: [
            "https://i.imgur.com/U2Ds4OR.jpg",
            "https://i.imgur.com/Q2rdGVQ.jpg",
            "https://i.imgur.com/Zn9oupF.jpg",
            "https://i.imgur.com/R0kbS1H.jpg",
        ],
        connectToGame: connectToGame(
            "wss://fake-artist.herokuapp.com/sockjs/rocketcrab/rocketcrab/websocket",
            "https://fake-artist.herokuapp.com/"
        ),
    },
    {
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
        showOn: [RocketcrabMode.MAIN],
        guideUrl: "https://www.ultraboardgames.com/insider/game-rules.php",
        pictures: [
            "https://i.imgur.com/i3rYxXt.jpg",
            "https://i.imgur.com/yy0ZpvT.jpg",
            "https://i.imgur.com/sIkwlKS.jpg",
            "https://i.imgur.com/MasoMRt.jpg",
            "https://i.imgur.com/3PBQodp.jpg",
        ],
        connectToGame: connectToGame(
            "wss://insider-online.herokuapp.com/sockjs/rocketcrab/rocketcrab/websocket",
            "https://insider-online.herokuapp.com/"
        ),
    },
];

export default game;
