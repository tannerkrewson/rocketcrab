import { ServerGame } from "../../types/types";
import { randomBytes } from "crypto";

const game: ServerGame = {
    id: "justone",
    name: "Just One",
    author: "CJ Quines",
    basedOn: {
        game: "Just One",
        author: "Ludovic Roudy & Bruno Sautter",
        link: "https://justone-the-game.com/?lang=en",
        bggId: 254640,
    },
    description: `Just One is a cooperative party game in which you play 
        together to discover as many mystery words as possible. Find the best 
        clue to help your teammate. Be unique, as all identical clues will be 
        cancelled! Everyone writes one-word clues to help a guesser guess their 
        mystery word. The catch: you can't show the guesser clues that two or 
        more people write.`,
    displayUrlText: "just1.herokuapp.com",
    displayUrlHref: "https://just1.herokuapp.com/",
    category: ["easy"],
    players: "1+",
    familyFriendly: true,
    guideId: "justone",
    pictures: [
        "https://i.imgur.com/KX3Sjsi.jpg",
        "https://i.imgur.com/dDu2mMg.jpg",
        "https://i.imgur.com/tZWRVvu.jpg",
        "https://i.imgur.com/hMeiX8k.jpg",
        "https://i.imgur.com/plGWABz.jpg",
    ],
    connectToGame: async () => {
        const id = randomBytes(8).toString("hex");
        return {
            player: {
                url: "https://just1.herokuapp.com/room/rocketcrab-" + id,
            },
        };
    },
};

export default game;
