import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const game: ServerGame = {
    id: "drawphone",
    name: "Drawphone",
    author: "Tanner Krewson",
    description: "Telephone with pictures",
    displayUrlText: "drawphone.tannerkrewson.com",
    displayUrlHref: "https://drawphone.tannerkrewson.com/",
    donationUrlText: "Buy Tanner a taco!",
    donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
    pictures: [
        "https://i.imgur.com/tHPfWpp.png",
        "https://i.imgur.com/EFQiuyd.png",
        "https://i.imgur.com/14aDZKn.png",
        "https://i.imgur.com/CwsMi5k.png",
    ],
    category: ["drawing", "easy"],
    players: "1+",
    familyFriendly: false,
    minPlayers: 1,
    maxPlayers: Infinity,
    getJoinGameUrl: async () => {
        const newUrl = "https://drawphone.tannerkrewson.com/new";
        const { gameCode } = await postJson(newUrl);
        return {
            playerURL: "https://drawphone.tannerkrewson.com/",
            code: gameCode,
        };
    },
};

export default game;
