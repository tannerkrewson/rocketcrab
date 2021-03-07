import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";
import { RocketcrabMode } from "../../types/enums";

const game: ServerGame = {
    id: "snakeout",
    name: "Snakeout",
    author: "Tanner Krewson",
    basedOn: {
        game: "The Resistance",
        author: "Don Eskridge",
        link:
            "https://indieboardsandcards.com/index.php/our-games/the-resistance/",
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
    showOn: [RocketcrabMode.MAIN, RocketcrabMode.KIDS],
    guideUrl: "https://snakeout.tannerkrewson.com/how-to-play",
    pictures: [
        "https://i.imgur.com/Doo5X0p.jpg",
        "https://i.imgur.com/YH0zR3c.jpg",
        "https://i.imgur.com/1Xf8j0g.jpg",
        "https://i.imgur.com/ET1S3Ff.jpg",
        "https://i.imgur.com/w568hdf.jpg",
        "https://i.imgur.com/00tlDOB.jpg",
    ],
    connectToGame: async () => {
        const newUrl = "https://snakeout.tannerkrewson.com/new";
        const { gameCode } = await postJson(newUrl);
        return {
            player: {
                url: "https://snakeout.tannerkrewson.com/",
                customQueryParams: {
                    code: gameCode,
                },
            },
        };
    },
};

export default game;
