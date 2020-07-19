import fs from "fs";
import path from "path";
import { ServerGame, ClientGame } from "../types/types";

const SERVER_GAME_LIST = fs
    .readdirSync(path.join(process.cwd(), "games"))
    .filter((file) => !file.startsWith("index."))
    .map((file) => {
        const name = file.substr(0, file.indexOf("."));
        return require("./" + name).default;
    });

export const getServerGameList = (): Array<ServerGame> => SERVER_GAME_LIST;

export const getClientGameList = (): Array<ClientGame> =>
    SERVER_GAME_LIST.map(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ({ getJoinGameUrl, ...clientGame }): ClientGame => clientGame
    );
