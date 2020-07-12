import { RocketCrab, Lobby, Player, GameState, Game } from "../types/types";
import { LobbyStatus, GameStatus } from "../types/enums";
import getGameList from "../games";
const GAME_LIST: Array<Game> = getGameList();

export const initRocketCrab = (): RocketCrab => ({
    lobbyList: [],
});

export const newLobby = (lobbyList: Array<Lobby>) => {
    const code: string = getUniqueGameCode(lobbyList);
    lobbyList.push({
        status: LobbyStatus.lobby,
        playerList: [],
        code,
        selectedGame: "",
        gameList: GAME_LIST,
        gameState: { status: GameStatus.loading },
    });
    return code;
};

export const getLobby = (newCode: string, lobbyList: Array<Lobby>) =>
    lobbyList.find(({ code }) => code === newCode);

export const addPlayer = (player: Player, playerList: Array<Player>) =>
    playerList.push(player);

export const sendStateToAll = (lobby: Lobby) =>
    lobby.playerList.forEach(({ socket, ...player }) =>
        socket.emit("update", { me: player, ...getJsonLobby(lobby) })
    );

export const removePlayer = (player: Player, playerList: Array<Player>) => {
    const { socket } = player;

    if (socket && socket.disconnect) {
        socket.disconnect(true);
    }

    deleteFromArray(player, playerList);
};

export const deleteLobbyIfEmpty = (lobby: Lobby, lobbyList: Array<Lobby>) => {
    const { playerList, code } = lobby;

    if (playerList.length === 0 && code !== "ffff") {
        // the only players that could possibly
        // be left are unnamed players
        disconnectAllPlayers(playerList);

        deleteFromArray(lobby, lobbyList);
    }
};

export const setName = (
    name: string,
    playerToName: Player,
    playerList: Array<Player>
): void => {
    const validLength = name.length > 1 && name.length <= 24;

    if (!findPlayerByName(name, playerList) && validLength) {
        // TODO: strip tags?
        playerToName.name = name;
    } else {
        playerToName.name = "";
        playerToName.socket.emit("invalid-name");
    }
};

export const setGame = (gameName: string, lobby: Lobby) => {
    if (findGameByName(gameName)) {
        lobby.selectedGame = gameName;
    }
};

export const startGame = (lobby: Lobby) => {
    // TODO: check if ready
    const { gameState, selectedGame } = lobby;

    const game: Game = findGameByName(selectedGame);
    if (!game) return;

    lobby.status = LobbyStatus.ingame;
    gameState.status = GameStatus.loading;

    game.getJoinGameUrl().then((url) => {
        //TODO handle failed to get url
        setJoinGameUrl(url, gameState);
        sendStateToAll(lobby);
    });
};

export const setJoinGameUrl = (url: string, gameState: GameState) => {
    gameState.status = GameStatus.inprogress;
    gameState.url = url;
};

const findPlayerByName = (
    nameToFind: string,
    playerList: Array<Player>
): Player => playerList.find(({ name }) => name === nameToFind);

const findGameByName = (gameName: string): Game =>
    GAME_LIST.find(({ name }) => name === gameName);

const disconnectAllPlayers = (playerList: Array<Player>) =>
    playerList.forEach(({ socket }) => socket.disconnect(true));

const getJsonLobby = ({ playerList, ...lobby }: Lobby) => ({
    playerList: playerList.map(({ name }) => ({ name })),
    ...lobby,
});

const getUniqueGameCode = (ll: Array<Lobby>) => {
    let newCode;
    do {
        newCode = getRandomFourLetters();
    } while (ll.find(({ code }) => code === newCode) && newCode !== "ffff");
    return newCode;
};

const getRandomFourLetters = () => {
    const len = 4;
    const possible = "abcdefghijklmnopqrstuvwxyz";

    let code = "";
    for (let i = 0; i < len; i++) {
        code += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return code;
};

const deleteFromArray = (item: any, array: Array<any>) => {
    const index = array.indexOf(item);
    if (index > -1) {
        array.splice(index, 1);
    }
};
