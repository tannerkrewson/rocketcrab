import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const game: ServerGame = {
    id: "qwiqwit",
    name: "QwiqWit",
    author: "Paul Wind & TypesInCode",
    description:
        "In QwiqWit, there's no right or wrong answers. Just enter what you think is funny. Your answers will go head-to-head against other players. The rest of the players in the room will vote on their favorite answer. Be sure to vote! It could be worth extra points (eventually).",
    displayUrlText: "qwiqwit.com",
    displayUrlHref: "https://www.qwiqwit.com/",
    category: ["easy"],
    players: "3-25",
    familyFriendly: true,
    getJoinGameUrl: async () => {
        return {
            playerURL: "https://www.qwiqwit.com/autojoin"
        }
    },
};

export default game;
