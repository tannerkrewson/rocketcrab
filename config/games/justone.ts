import { ServerGame } from "../../types/types";
import { randomBytes } from "crypto";

const game: ServerGame = {
    id: "cjq-justone",
    name: "Just One",
    author: "CJ Quines",
    description: "A cooperative word guessing game",
    displayUrlText: "just1.herokuapp.com",
    displayUrlHref: "https://just1.herokuapp.com/",
    category: ["easy"],
    players: "1+",
    familyFriendly: true,
    getJoinGameUrl: async () => {
        const id = randomBytes(8).toString("hex");
        return {
            playerURL: "https://just1.herokuapp.com/room/rocketcrab-" + id,
        };
    },
};

export default game;
