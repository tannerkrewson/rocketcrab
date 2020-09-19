import { ServerGame } from "../../types/types";

const game: ServerGame = {
    id: "setwithfriends",
    name: "Set with Friends",
    author: "Eric Zhang & Cynthia Du",

    basedOn: {
        game: "Set",
        author: "Marsha Falco",

        link: "https://www.playmonster.com/product/set/",
    },

    description: "Find the triplets!",

    displayUrlText: "setwithfriends.com",
    displayUrlHref: "https://setwithfriends.com/",

    category: ["easy"],

    familyFriendly: true,

    getJoinGameUrl: async () => {
        const pool = [
            "mutual-steadfast-underwear",
            "unkempt-honest-sea",
            "savvy-hilarious-bee",
            "laughable-adorable-popcorn",
            "quarrelsome-fluent-amount",
            "merry-yummy-air",
            "glossy-concerned-shape",
            "near-sharp-kick",
            "shaggy-flimsy-touch",
            "merry-ubiquitous-advice",
            "chivalrous-adaptable-boot",
            "pleasant-sour-tramp",
            "normal-rigid-hot",
            "yummy-coherent-machine",
            "ubiquitous-blue-pigs",
            "dizzy-tired-wine",
            "ablaze-quixotic-bucket",
            "substantial-proper-breath",
        ];

        const roomName = pool[Math.floor(Math.random() * pool.length)];
        await fetch(
            "https://us-central1-setwithfriends.cloudfunctions.net/createGame",
            {
                method: "POST",
                body: JSON.stringify({
                    gameId: roomName,
                    access: "private",
                }),
                headers: {
                    authorization:
                        "Bearer " + Math.random().toString(36).substring(10),
                },
            }
        );

        return {
            playerURL: "https://setwithfriends.com/room/" + roomName,
        };
    },
};

export default game;
