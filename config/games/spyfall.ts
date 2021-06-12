import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";
import { RocketcrabMode } from "../../types/enums";

const game: ServerGame = {
    id: "tk-spyfall",
    name: "Spyfall",
    author: "Tanner Krewson",
    basedOn: {
        game: "Spyfall",
        author: "Alexandr Ushan",
        link: "https://www.cryptozoic.com/spyfall",
        bggId: 166384,
    },
    description: `In Spyfall, one random player will become the spy, and all 
        others will be given a location and a role within the location. For 
        example, if the location of a round was "restaurant," one player might 
        be the chef, another the waiter, another the customer, etc. The players 
        will not know who the spy is, and the spy will not know the location. 

        Players take turns asking questions to each other, doing their best not 
        to outright reveal the location in their questions and answers, but not 
        being too vague as to raise suspicion. The non-spy group of players 
        wins if they unanimously agree on the identity of the spy player. The 
        spy wins if they figure out the location, which they have one chance to 
        yell out at any time during the round, but loses if they guess wrong. 
        The spy also wins if the other players unanimously accuse someone else, 
        or cannot unanimously decide on someone to accuse.`,
    displayUrlText: "spyfall.tannerkrewson.com",
    displayUrlHref: "https://spyfall.tannerkrewson.com/",
    donationUrlText: "Buy Tanner a taco!",
    donationUrlHref: "https://www.buymeacoffee.com/tannerkrewson",
    guideId: "spyfall",
    category: ["medium"],
    players: "4+",
    showOn: [RocketcrabMode.MAIN],
    minPlayers: 1,
    maxPlayers: Infinity,
    pictures: [
        "https://i.imgur.com/gAYGUUC.jpg",
        "https://i.imgur.com/8VMpYns.jpg",
    ],
    connectToGame: async () => {
        const newUrl = "https://spyfall.tannerkrewson.com/new";
        const { gameCode } = await postJson(newUrl);
        return {
            player: { url: "https://spyfall.tannerkrewson.com/" + gameCode },
        };
    },
};

export default game;
