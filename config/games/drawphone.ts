import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";
import { RocketcrabMode } from "../../types/enums";

const toConnectToGame = (url) => async () => {
    const newUrl = url + "new";
    const { gameCode } = await postJson(newUrl);
    return {
        player: {
            url,
            customQueryParams: {
                code: gameCode,
            },
        },
    };
};

const drawphone: ServerGame = {
    id: "drawphone",
    name: "Drawphone",
    author: "Tanner Krewson",
    description: `In Drawphone, there are no winners... only losers! Players 
        take turns drawing pictures and guessing what those pictures are. If 
        you guess correctly, nothing happens! If you guess wrong or draw like a 
        toddler and ruin the chain of drawings and guesses, rest assured that 
        you will be mercilessly mocked for your honest mistake (which 
        ultimately doesn't even matter in the grand scheme of the world).

        Drawphone was inspired by Evan Brumley's 2015 online Spyfall 
        implementation, Jackbox Games's Drawful, and Telestrations.`,
    displayUrlText: "drawphone.tannerkrewson.com",
    displayUrlHref: "https://drawphone.tannerkrewson.com/",
    donationUrlText: "Buy Tanner a taco!",
    donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
    guideUrl: "https://drawphone.tannerkrewson.com/how-to-play",
    pictures: [
        "https://i.imgur.com/tHPfWpp.png",
        "https://i.imgur.com/EFQiuyd.png",
        "https://i.imgur.com/14aDZKn.png",
        "https://i.imgur.com/CwsMi5k.png",
    ],
    category: ["drawing", "easy"],
    players: "1+",
    showOn: [RocketcrabMode.MAIN],
    minPlayers: 1,
    maxPlayers: Infinity,
    connectToGame: toConnectToGame("https://drawphone.tannerkrewson.com/"),
};

export default [
    drawphone,
    {
        ...drawphone,
        id: "drawphone-kids",
        name: "Drawphone for Kids",
        description:
            drawphone.description +
            "\n\nNOTE: Age-restricted word packs are removed from Drawphone for Kids. Players can still draw and guess unrestricted.",
        showOn: [RocketcrabMode.KIDS],
        connectToGame: toConnectToGame("https://dpk.tannerkrewson.com/"),
    },
];
