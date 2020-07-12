import { Game } from "../types/types";
import { postJson } from "../utils/utils";

const game: Game = {
    name: "Spyfall",
    getJoinGameUrl: async () => {
        const newUrl = "https://spyfall.tannerkrewson.com/new";
        const { gameCode } = await postJson(newUrl);
        return "https://spyfall.tannerkrewson.com/" + gameCode;
    },
};

export default game;
