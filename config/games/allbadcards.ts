import { randomBytes } from "crypto";
import { ServerGame } from "../../types/types";

const game: ServerGame = {
    id: "allbadcards",
    name: "All Bad Cards",
    author: "Jake Lauer",
    basedOn: {
        game: "Cards Against Humanity",
        link: "https://cardsagainsthumanity.com/",
    },
    description:
        "Be rude. Be irreverent. Be hilarious! Select the card from your hand that you think is best described by a card played by the judge!",
    displayUrlText: "allbad.cards",
    displayUrlHref: "https://allbad.cards/",
    donationUrlText: "Support Jake on Patreon!",
    donationUrlHref: "https://www.patreon.com/Allbadcards",
    category: ["easy"],
    players: "4-20+",
    familyFriendly: false,
    connectToGame: async () => {
        const roomId = "rocketcrab-" + randomBytes(8).toString("hex");
        return {
            player: {
                url: "https://allbad.cards/api/abc/external-create",
                customQueryParams: { roomId: "external-room-" + roomId },
            },
            host: {
                customQueryParams: { roomId },
            },
        };
    },
    renameParams: {
        name: "userName",
        ishost: "isHost",
    },
};

export default game;
