import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const game: ServerGame = {
    id: "snakeout",
    name: "Snakeout",
    author: "Tanner Krewson",
    basedOn: {
        game: "The Resistance",
        author: "Don Eskridge",
        link:
            "https://www.amazon.com/The-Resistance-Dystopian-Universe/dp/B008A2BA8G/",
    },
    description: `Out the snake, or be outed as a snake! 🐍
    
        Snakeout is a game in which a team of loyalists is infiltrated by a 
        group of snakes. The loyalists must try to figure out who the snakes 
        are, and the snakes must try to keep the loyalists from figuring out 
        their identity. The game is separated into five missions. The first 
        team to "win" three missions wins the game.`,
    displayUrlText: "snakeout.tannerkrewson.com",
    displayUrlHref: "https://snakeout.tannerkrewson.com/",
    donationUrlText: "Buy Tanner a taco!",
    donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
    category: ["medium"],
    players: "5-10",
    familyFriendly: true,
    guideUrl: "https://snakeout.tannerkrewson.com/how-to-play",
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
