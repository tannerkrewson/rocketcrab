import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const game: ServerGame = {
    id: "tk-spyfall",
    name: "Spyfall",
    author: "Tanner Krewson",
    description: "formerly Crabhat",
    displayUrlText: "spyfall.tannerkrewson.com",
    displayUrlHref: "https://spyfall.tannerkrewson.com/",
    donationUrlText: "Buy Tanner a taco!",
    donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
    category: ["medium"],
    players: "4+",
    familyFriendly: true,
    minPlayers: 1,
    maxPlayers: Infinity,
    getJoinGameUrl: async () => {
        const newUrl = "https://spyfall.tannerkrewson.com/new";
        const { gameCode } = await postJson(newUrl);
        return {
            playerURL: "https://spyfall.tannerkrewson.com/" + gameCode,
        };
    },
};

export default game;
