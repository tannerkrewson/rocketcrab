import { ClientGame, ConnectedGame, Player } from "../types/types";

export const useConnectedGame = (
    connectedGame: ConnectedGame,
    { renameParams }: ClientGame,
    { isHost, name }: Player
): string => {
    if (!connectedGame?.player) return "";

    const { url, customQueryParams, afterQueryParams } = isHost
        ? { ...connectedGame.player, ...connectedGame.host } // for host, overwrite anything from player onto host
        : connectedGame.player;

    const paramKeys = {
        rocketcrab: "rocketcrab",
        name: "name",
        ishost: "ishost",
        ...renameParams,
    };

    const defaultParams = {
        rocketcrab: "true",
        name,
        ishost: isHost.toString(),
    };

    const params = {
        ...Object.keys(paramKeys).reduce(
            (acc, name) => ({
                ...acc,
                [paramKeys[name]]: defaultParams[name],
            }),
            {}
        ),
        ...customQueryParams,
    };

    const stringOfCustomQueryParams =
        "?" + new URLSearchParams(params).toString();

    return url + stringOfCustomQueryParams + (afterQueryParams ?? "");
};
