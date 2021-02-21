import fs from "fs";
import path from "path";
import {
    ServerGame,
    ClientGame,
    ServerGameLibrary,
    ClientGameLibrary,
} from "../types/types";

import categories from "./categories.json";

const SERVER_GAME_LIST: Array<ServerGame> = fs
    .readdirSync(path.join(process.cwd(), "config", "games"))
    .filter((file) => !file.startsWith("_") && file.endsWith(".ts"))
    .reduce((games, file) => {
        const name = file.substr(0, file.indexOf("."));
        const exported = require("./games/" + name).default;
        const newGames = Array.isArray(exported) ? exported : [exported];
        return [...games, ...newGames];
    }, [])
    .map((game) => {
        if (!game.guideId) return game;

        const guide = fs.readFileSync(
            path.join(process.cwd(), "config", "guides", game.guideId + ".md"),
            "utf8"
        );

        return { ...game, guide };
    });

const CLIENT_GAME_LIST: Array<ClientGame> = SERVER_GAME_LIST.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ connectToGame, ...clientGame }): ClientGame => clientGame
);

/*
    On rocketcrab.com, show all games.
    On kids.rocketcrab.com, show only kid games.
*/
const getClientGameList = ({
    kidsOnly,
}: {
    kidsOnly: boolean;
}): Array<ClientGame> =>
    CLIENT_GAME_LIST.filter(({ familyFriendly }) => {
        if (kidsOnly && !familyFriendly) return false;
        return true;
    });

export const getServerGameLibrary = (): ServerGameLibrary => ({
    categories,
    gameList: SERVER_GAME_LIST,
});

export const getClientGameLibrary = (): ClientGameLibrary => ({
    categories,
    gameList: getClientGameList({
        kidsOnly: false,
    }),
});
