import { postJson } from "../utils/utils";

export default {
    name: "Spyfall",
    getNewGameUrl: async () => {
        const newUrl = "https://spyfall.tannerkrewson.com/new";
        const { gameCode } = await postJson(newUrl);
        return "https://spyfall.tannerkrewson.com/" + gameCode;
    },
};
