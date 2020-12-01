import { ServerGame } from "../../types/types";

const game: ServerGame = {
    id: "setwithfriends",
    name: "Set with Friends",
    author: "Eric Zhang & Cynthia Du",

    basedOn: {
        game: "Set",
        author: "Marsha Falco",
        link: "https://www.playmonster.com/product/set/",
        bggId: 1198,
    },

    description: "Find the triplets!",

    displayUrlText: "setwithfriends.com",
    displayUrlHref: "https://setwithfriends.com/",

    category: ["easy"],

    familyFriendly: true,

    connectToGame: async () => {
        const roomName =
            "rocketcrab-" + Math.random().toString(36).substring(8);

        const auth = await fetch(
            "https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=AIzaSyCeKQ4rauZ_fq1rEIPJ8m5XfppwjtmTZBY",
            {
                method: "POST",
                body: JSON.stringify({
                    returnSecureToken: true,
                }),
                headers: {
                    "content-type": "application/json",
                    referer: "https://setwithfriends.com/",
                },
            }
        );

        const { idToken } = await auth.json();

        await fetch(
            "https://us-central1-setwithfriends.cloudfunctions.net/createGame",
            {
                method: "POST",
                body: JSON.stringify({
                    data: {
                        gameId: roomName,
                        access: "private",
                    },
                }),
                headers: {
                    authorization: "Bearer " + idToken,
                    "content-type": "application/json",
                },
            }
        );

        return {
            player: { url: "https://setwithfriends.com/room/" + roomName },
        };
    },
};

export default game;
