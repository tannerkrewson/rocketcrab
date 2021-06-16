import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const game: ServerGame = {
    id: "secrethitler-duc",
    name: "Secret Hitler",
    author: "Duc Ngo Viet",
    description: `Secret Hitler is a social deduction game for 5-10 people about finding and stopping the Secret Hitler. Players are secretly divided into two teams: the liberals, who have a majority, and the fascists, who are hidden to everyone but each other. If the liberals can learn to trust each other, they have enough votes to control the elections and save the day. But the fascists will say whatever it takes to get elected, advance their agenda, and win the game.`,
    displayUrlText: "secret-hitler.com",
    displayUrlHref: "https://secret-hitler.com/",
    donationUrlText: "Buy ducci a coffee!",
    donationUrlHref: "https://www.buymeacoffee.com/ducci",
    guideUrl: "https://www.ultraboardgames.com/secret-hitler/game-rules.php",
    pictures: [
        "https://i.imgur.com/1WunWnQ.jpg",
        "https://i.imgur.com/qGLaOnR.jpg",
        "https://i.imgur.com/dZ0J1GS.jpg",
        "https://i.imgur.com/W6T40Ot.jpg",
    ],
    category: ["hard"],
    players: "5-10",
    familyFriendly: false,
    minPlayers: 5,
    maxPlayers: 10,
    connectToGame: async () => {
        const newUrl = "https://inspiring-hugle-c583a0.netlify.app/.netlify/functions/secretHitler";
        const { gameCode } = await postJson(newUrl);
        return {
            player: {
                url: "https://secret-hitler.com/",
                customQueryParams: {
                    roomId: gameCode,
                },
            },
        };
    },
};

export default game;
