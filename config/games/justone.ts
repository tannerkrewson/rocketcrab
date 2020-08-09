import { ServerGame } from "../../types/types";
import { randomBytes } from "crypto";

const game: ServerGame = {
    name: "Just One",
    author: "Kevin Kwok",
    description: "A cooperative word guessing game",
    displayUrlText: "just1.herokuapp.com",
    displayUrlHref: "https://just1.herokuapp.com/",
    category: ["trivia"],
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
