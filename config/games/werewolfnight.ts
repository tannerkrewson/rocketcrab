import { ServerGame } from "../../types/types";
import { postJson } from "../../utils/utils";

const game: ServerGame = {
    id: "werewolfnight",
    name: "werewolf-night.com",
    author: "Duc Ngo Viet",
    description: `Werewolf-night is an interactive deduction game for
    two teams: the villagers and the werewolves.
    While the villagers do not know who the werewolves are, the werewolves try to remain undiscovered
    and eliminate one villager after the other.
    one by one...`,
    displayUrlText: "werewolf-night.com",
    displayUrlHref: "https://werewolf-night.com/",
    donationUrlText: "Buy ducci a coffee!",
    donationUrlHref: "https://www.buymeacoffee.com/ducci",
    guideUrl: "https://werewolf-night.com/roles",
    pictures: [
        "https://i.imgur.com/A7yqerc.jpg",
        "https://i.imgur.com/He5amxk.jpg",
        "https://i.imgur.com/96lH5JJ.jpg",
        "https://i.imgur.com/17PUnb0.jpg",
    ],
    category: ["hard"],
    players: "5-16",
    familyFriendly: true,
    minPlayers: 5,
    maxPlayers: 16,
    connectToGame: async () => {
        const newUrl = "https://werewolf.uber.space/newRoom";
        const { gameCode } = await postJson(newUrl);
        return {
            player: {
                url: "https://werewolf-night.com/game",
                customQueryParams: {
                    roomId: gameCode,
                },
            },
        };
    },
};

export default game;
