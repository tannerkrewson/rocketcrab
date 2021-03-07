import { ServerGame } from "../../types/types";
import { randomBytes } from "crypto";
import { RocketcrabMode } from "../../types/enums";

const game: ServerGame = {
    id: "longwave",
    name: "Longwave",
    author: "Evan Bailey & Margarethe Schoen",
    basedOn: {
        game: "Wavelength",
        author: "Wolfgang Warsch, Alex Hague, & Justin Vickers",
        link: "https://www.wavelength.zone/",
    },
    description:
        "Wavelength is a social guessing game where two teams compete to read each other's minds. It’s a thrilling experience of TALKING and THINKING and HIGH FIVING that anyone can play—but it also has some of that deep word game sorcery, like Codenames, where your decisions feel tense, strategic, meaningful. ",
    displayUrlText: "longwave.web.app",
    displayUrlHref: "https://longwave.web.app/",
    category: ["easy"],
    players: "2-12+",
    showOn: [RocketcrabMode.MAIN, RocketcrabMode.KIDS],
    guideUrl: "https://www.ultraboardgames.com/wavelength/game-rules.php",
    pictures: [
        "https://i.imgur.com/yDx8aln.jpg",
        "https://i.imgur.com/JrjlylN.jpg",
        "https://i.imgur.com/57LlwWA.jpg",
        "https://i.imgur.com/cuGMgKv.jpg",
        "https://i.imgur.com/u36UW03.jpg",
    ],
    connectToGame: async () => {
        const id = randomBytes(8).toString("hex");
        return {
            player: { url: "https://longwave.web.app/rocketcrab-" + id },
        };
    },
};

export default game;
