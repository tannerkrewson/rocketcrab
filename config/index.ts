import fs from "fs";
import path from "path";

import drawphone from "./games/drawphone.ts";
import fishbowl from "./games/fishbowl.ts";
import justone from "./games/justone.ts";
import longwave from "./games/longwave.ts";
import netgamesio from "./games/netgamesio.ts";
import outofcontextparty from "./games/outofcontextparty.ts";
import qwiqwit from "./games/qwiqwit.ts";
import secrethitler from "./games/secrethitler.ts";
import snakeout from "./games/snakeout.ts";
import spyfall from "./games/spyfall.ts";
import werewolfnight from "./games/werewolfnight.ts";

import {
    ServerGame,
    ClientGame,
    ServerGameLibrary,
    ClientGameLibrary,
    GameCategory,
} from "../types/types.ts";
import { RocketcrabMode } from "../types/enums.ts";

import CATEGORIES_RAW from "./categories.json";
const CATEGORIES: Array<GameCategory> = CATEGORIES_RAW;

const CONFIGURED_GAME_MODULES = [
    drawphone,
    fishbowl,
    justone,
    longwave,
    netgamesio,
    outofcontextparty,
    qwiqwit,
    secrethitler,
    snakeout,
    spyfall,
    werewolfnight,
];

const SERVER_GAME_LIST: Array<ServerGame> = CONFIGURED_GAME_MODULES.flatMap(
    (games) => (Array.isArray(games) ? games : [games]),
).map((game) => {
    if (!game.guideId) return game;

    const guide = fs.readFileSync(
        path.join(process.cwd(), "config", "guides", game.guideId + ".md"),
        "utf8",
    );

    return { ...game, guide };
});

const CLIENT_GAME_LIST: Array<ClientGame> = SERVER_GAME_LIST.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ connectToGame, ...clientGame }): ClientGame => clientGame,
);

export const getServerGameLibrary = (): ServerGameLibrary => ({
    categories: CATEGORIES,
    gameList: SERVER_GAME_LIST,
});

export const getClientGameLibrary = (
    mode: RocketcrabMode,
): ClientGameLibrary => {
    const gameList = CLIENT_GAME_LIST.filter(
        ({ showOn }) => mode === RocketcrabMode.ALL || showOn?.includes(mode),
    );

    const categoriesOfThisGameList = gameList
        .map(({ category }) => category)
        .flat();
    const categories = CATEGORIES.filter(
        ({ id }) =>
            categoriesOfThisGameList.find((categoryId) => id === categoryId) ||
            id === "recent", // always include the recent category
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
