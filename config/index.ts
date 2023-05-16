import fs from "fs";
import path from "path";
import {
    ServerGame,
    ClientGame,
    ServerGameLibrary,
    ClientGameLibrary,
    GameCategory,
} from "../types/types";
import { RocketcrabMode } from "../types/enums";

import CATEGORIES_RAW from "./categories.json";
const CATEGORIES: Array<GameCategory> = CATEGORIES_RAW;

const SERVER_GAME_LIST: Array<ServerGame> = (
    await Promise.all(
        fs
            .readdirSync(path.join(process.cwd(), "config", "games"))
            .filter((file) => !file.startsWith("_") && file.endsWith(".ts"))
            .map((file) => {
                const name = file.substring(0, file.indexOf("."));
                return require("./games/" + name);
            })
    )
)
    .reduce((games, exported) => {
        const newGames = Array.isArray(exported.default)
            ? exported.default
            : [exported.default];
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

export const getServerGameLibrary = (): ServerGameLibrary => ({
    categories: CATEGORIES,
    gameList: SERVER_GAME_LIST,
});

export const getClientGameLibrary = (
    mode: RocketcrabMode
): ClientGameLibrary => {
    const gameList = CLIENT_GAME_LIST.filter(
        ({ showOn }) => mode === RocketcrabMode.ALL || showOn?.includes(mode)
    );

    const categoriesOfThisGameList = gameList
        .map(({ category }) => category)
        .flat();
    const categories = CATEGORIES.filter(
        ({ id }) =>
            categoriesOfThisGameList.find((categoryId) => id === categoryId) ||
            id === "recent" // always include the recent category
    );

    return {
        categories,
        gameList,
    };
};

export const GAME_LIBRARY = {
    [RocketcrabMode.MAIN]: getClientGameLibrary(RocketcrabMode.MAIN),
    [RocketcrabMode.KIDS]: getClientGameLibrary(RocketcrabMode.KIDS),
};
