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
    .filter((file) => !file.startsWith("index."))
    .map((file) => {
        const name = file.substr(0, file.indexOf("."));
        return require("./games/" + name).default;
    });

const getClientGameList = (): Array<ClientGame> =>
    SERVER_GAME_LIST.map(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ({ getJoinGameUrl, ...clientGame }): ClientGame => clientGame
    );

export const getServerGameLibrary = (): ServerGameLibrary => ({
    categories,
    gameList: SERVER_GAME_LIST,
});

export const getClientGameLibrary = (): ClientGameLibrary => ({
    categories,
    gameList: getClientGameList(),
});
