import { randomBytes } from "crypto";
import { ServerGame } from "../../types/types";

const gameTemplate = ({
    id,
    name,
    description,
    displayUrlText,
    displayUrlHref,
    basedOn,
    category,
    players,
    familyFriendly,
    guideUrl,
    guideId,
}: //pictures,
Partial<ServerGame>): ServerGame => ({
    id,
    name: name,
    author: "Jake Lauer",
    basedOn,
    description,
    displayUrlText,
    displayUrlHref,
    donationUrlText: "Support Jake on Patreon!",
    donationUrlHref: "https://www.patreon.com/Allbadcards",
    category,
    players,
    familyFriendly,
    //pictures,
    ...(guideUrl ? { guideUrl } : {}),
    ...(guideId ? { guideId } : {}),
    connectToGame: async () => {
        const roomId = "rocketcrab-" + randomBytes(8).toString("hex");
        return {
            player: {
                url: displayUrlHref + "api/external-create",
                customQueryParams: { roomId },
            },
        };
    },
    renameParams: {
        name: "userName",
        ishost: "isHost",
    },
});

const games: Array<ServerGame> = [
    gameTemplate({
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
        category: ["easy"],
        players: "4-20+",
        familyFriendly: false,
    }),
    gameTemplate({
        id: "notallbadcards",
        name: "(not) All Bad Cards",
        author: "Jake Lauer",
        basedOn: {
            game: "Apples to Apples",
            link:
                "https://www.mattelgames.com/games/en-us/family/apples-apples",
        },
        description:
            "PG Family-friendly edition! be hilarious! Select the card from your hand that you think is best described by a card played by the judge!",
        displayUrlText: "not.allbad.cards",
        displayUrlHref: "https://not.allbad.cards/",
        category: ["easy"],
        players: "4-20+",
        familyFriendly: true,
    }),
    gameTemplate({
        id: "allbadmemes",
        name: "All Bad Memes",
        author: "Jake Lauer",
        basedOn: undefined,
        description: "Caption to your heart's content.",
        displayUrlText: "memes.allbad.cards",
        displayUrlHref: "https://memes.allbad.cards/",
        category: ["easy"],
        players: "4-20+",
        familyFriendly: true,
    }),
];

export default games;
