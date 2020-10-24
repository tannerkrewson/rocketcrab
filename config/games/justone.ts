import { ServerGame } from "../../types/types";
import { randomBytes } from "crypto";

const game: ServerGame = {
    id: "justone",
    name: "Just One",
    author: "CJ Quines",
    basedOn: {
        game: "Just One",
        author: "Ludovic Roudy & Bruno Sautter",
        link:
            "https://www.amazon.com/Repos-JOUS01-Just-One-dp-B07W3PJTL2/dp/B07W3PJTL2/",
    },
    description: "A cooperative word guessing game",
    displayUrlText: "just1.herokuapp.com",
    displayUrlHref: "https://just1.herokuapp.com/",
    category: ["easy"],
    players: "1+",
    familyFriendly: true,
    guideId: "justone",
    getJoinGameUrl: async () => {
        const id = randomBytes(8).toString("hex");
        return {
            playerURL: "https://just1.herokuapp.com/room/rocketcrab-" + id,
        };
    },
};

export default game;
