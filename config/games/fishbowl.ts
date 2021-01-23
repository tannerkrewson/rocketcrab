import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const game: ServerGame = {
    id: "fishbowl",
    name: "Fishbowl",
    author: "Avi Moondra",
    description:
        "Fishbowl is a virtual version of a fun (and mostly hilarious) guessing game, designed for any group of all ages! You'll need at least 4 to play, but it only gets more fun with more players. Hop on a video call, and play through rounds of Taboo, Charades, and Password.",
    displayUrlText: "fishbowl-game.com",
    displayUrlHref: "https://fishbowl-game.com/",
    donationUrlText: "Buy Avi a coffee!",
    donationUrlHref: "https://www.buymeacoffee.com/fishbowlgame",
    guideId: "fishbowl",
    pictures: [
        "https://i.imgur.com/bWlUX5R.jpg",
        "https://i.imgur.com/YkEzh3q.jpg",
        "https://i.imgur.com/Kj5ZZyV.jpg",
        "https://i.imgur.com/NZB2fGn.jpg",
        "https://i.imgur.com/EgXpK11.jpg",
        "https://i.imgur.com/eY5NF46.jpg",
        "https://i.imgur.com/OtRqoy5.jpg",
        "https://i.imgur.com/DPCalID.jpg",
    ],
    category: ["easy"],
    players: "4+",
    familyFriendly: true,
    connectToGame: async () => {
        const newGameUrl = "https://fishbowl-graphql.onrender.com/v1/graphql";
        const {
            data: {
                newGame: { join_code },
            },
        } = await postJson(newGameUrl, {
            query: "mutation  {\n  newGame {\n    join_code\n  }\n}\n",
            variables: null,
        });
        return {
            player: {
                url: "https://fishbowl-game.com/game/" + join_code + "/lobby",
            },
        };
    },
    renameParams: {
        rocketcrab: "hideshare",
    },
};

export default game;
