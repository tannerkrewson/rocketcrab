import { ServerGame } from "../../types/types";
import { randomBytes } from "crypto";

const game: ServerGame = {
	id: "simonionburg",
	name: "Simonionburg",
	author: "Simon Weisse",
	basedOn: {
		game: "Quacks of Quedlinburg and Dominion (loosely)",
		author: "Wolfgang Warsch (Quacks), Donald X. Vaccarino (Dominion)",
		link: "https://boardgamegeek.com/boardgame/244521/quacks-quedlinburg", // https://dominion.games/ for a second game link /shrug
	},
	description: "A deck-building game similar to Quacks of Quedlinburg with elements taken from Dominion.  Built for a phone, but can be played anywhere.  Test it out with just yourself, or invite friends for the full experience!  Your deck starts with many Bane cards.  Playing too many Bane cards causes you to bust.  Add other cards to your deck and play the odds to get an advantage over your opponents.",
	displayUrlText: "simonionburg.azurewebsites.net",
	displayUrlHref: "https://simonionburg.azurewebsites.net",
	donationUrlText: "Buy Simon a box of tea!",
	donationUrlHref: "https://www.buymeacoffee.com/Soupy",
	guideUrl: "https://simonionburg.azurewebsites.net/rules",
	pictures: ["https://i.imgur.com/EfaXiyj.png", "https://i.imgur.com/Qiyk9rU.png", "https://i.imgur.com/puet749.png", "https://i.imgur.com/S96YZz1.png"],
	category: ["hard"],
	players: "1+ (3-7 is great)",
	familyFriendly: true,
	minPlayers: 1,
	maxPlayers: Infinity,
	connectToGame: async () => {
		const code = randomBytes(8).toString("hex");
		return {
			player: {
				url: "https://simonionburg.azurewebsites.net/createOrJoin/" + code,
			}
		};
	},
};
export default game;
