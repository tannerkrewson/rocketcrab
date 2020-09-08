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
        const name = "rocketcrab";

        const {
            authUser: { parentId },
        } = await postJson("https://www.qwiqwit.com/login", {
            name,
        });

        const { roomCode } = await fetch(
            "https://www.qwiqwit.com/createprivate",
            {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    Cookie:
                        "08.AuthCookie.authId=" +
                        parentId +
                        "; 08.AuthCookie.name=" +
                        name,
                },
            }
        ).then((res) => res.json());

        return {
            playerURL: "https://www.qwiqwit.com/room/" + roomCode,
        };
    },
};

export default game;
