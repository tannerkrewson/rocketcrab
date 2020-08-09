import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const game: ServerGame = {
    name: "Snakeout",
    author: "Tanner Krewson",
    description: "Out the snake, or be outed as a snake",
    displayUrlText: "snakeout.tannerkrewson.com",
    displayUrlHref: "https://snakeout.tannerkrewson.com/",
    donationUrlText: "Buy Tanner a taco!",
    donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
    category: ["medium"],
    players: "5-10",
    familyFriendly: true,
    getJoinGameUrl: async () => {
        const newUrl = "https://snakeout.tannerkrewson.com/new";
        const { gameCode } = await postJson(newUrl);
        return {
            playerURL: "https://snakeout.tannerkrewson.com/",
            code: gameCode,
        };
    },
};

export default game;
