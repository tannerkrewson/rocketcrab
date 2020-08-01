import { ServerGame } from "../../types/types";

const game: ServerGame = {
    name: "Drawphone",
    author: "Tanner Krewson",
    description: "Telephone with pictures",
    displayUrlText: "drawphone.tannerkrewson.com",
    displayUrlHref: "https://drawphone.tannerkrewson.com/",
    category: ["drawing"],
    players: "1+",
    familyFriendly: false,
    minPlayers: 1,
    maxPlayers: Infinity,
    getJoinGameUrl: async () => ({
        playerURL: "https://drawphone.tannerkrewson.com",
        code: "abcd",
    }),
};

export default game;
