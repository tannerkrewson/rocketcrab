import { RocketCrab, Lobby, Player, ServerGame } from "../types/types";
import { LobbyStatus, GameStatus } from "../types/enums";
import { getServerGameLibrary } from "../config";
const SERVER_GAME_LIST: Array<ServerGame> = getServerGameLibrary().gameList;

export const initRocketCrab = (isDevMode?: boolean): RocketCrab => {
    const lobbyList: Array<Lobby> = [];

    if (isDevMode) newLobby(lobbyList, "ffff");

    return { lobbyList };
};

export const newLobby = (
    lobbyList: Array<Lobby>,
    gameCode?: string,
    uuid?: string
): Lobby => {
    const code: string = gameCode || getUniqueGameCode(lobbyList);
    const newLobby: Lobby = {
        status: LobbyStatus.lobby,
        playerList: [],
        code,
        uuid,
        selectedGame: "",
        gameState: {
            status: GameStatus.loading,
            joinGameURL: { playerURL: "", hostURL: "" },
        },
        nextPlayerId: 0,
        idealHostId: 0,
    };
    lobbyList.push(newLobby);
    return newLobby;
};

export const getLobby = (newCode: string, lobbyList: Array<Lobby>): Lobby =>
    lobbyList.find(({ code }) => code === newCode);

export const addPlayer = (
    name: string,
    socket: SocketIO.Socket,
    lobby: Lobby,
    previousId?: number
): Player => {
    const { playerList } = lobby;

    const idNotInUse = !isIDinUse(previousId, lobby.playerList);
    const usePreviousId = Number.isInteger(previousId) && idNotInUse;
    const id = usePreviousId ? previousId : lobby.nextPlayerId++;

    const isFirstPlayer = playerList.length === 0;

    // this is mostly only important for the ffff dev lobby
    // in which ids are previousIds that were not created
    // in this instance of the lobby are being used
    if (id > lobby.nextPlayerId) {
        lobby.nextPlayerId = id + 1;
    }

    const player: Player = {
        id,
        name: "",
        socket,
        isHost: false,
    };
    playerList.push(player);

    setName(name, player, playerList);

    if (isFirstPlayer) {
        lobby.idealHostId = id;
    }

    setHost(lobby.idealHostId, playerList);

    return player;
};

export const sendStateToAll = (lobby: Lobby): void =>
    lobby.playerList.forEach(({ socket, ...player }) =>
        socket.emit("update", { me: player, ...getJsonLobby(lobby) })
    );

export const removePlayer = (player: Player, lobby: Lobby): void => {
    const { playerList, idealHostId } = lobby;
    const { socket } = player;

    if (socket && socket.disconnect) {
        socket.disconnect(true);
    }

    deleteFromArray(player, playerList);

    if (player.isHost) {
        setHost(idealHostId, playerList);
    }
};

export const deleteLobbyIfEmpty = (
    lobby: Lobby,
    lobbyList: Array<Lobby>
): void => {
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
    const validLength = typeof name === "string" && name.length <= 24;

    if (!findPlayerByName(name, playerList) && validLength) {
        playerToName.name = name;
    } else {
        playerToName.name = "";

        // prevents error if no cookie was set
        if (name) {
            playerToName.socket.emit("invalid-name");
        }
    }
};

export const setGame = (gameId: string, lobby: Lobby): void => {
    if (findGameById(gameId)) {
        lobby.selectedGame = gameId;
    }
};

export const startGame = async (lobby: Lobby): Promise<void> => {
    // TODO: check if ready
    const { gameState, selectedGame, playerList } = lobby;

    const game: ServerGame = findGameById(selectedGame);
    if (!game) return;

    lobby.status = LobbyStatus.ingame;
    gameState.status = GameStatus.loading;
    sendStateToAll(lobby);

    try {
        gameState.joinGameURL = await game.getJoinGameUrl();
    } catch (e) {
        gameState.status = GameStatus.error;
        gameState.error = "❌ Can't connect to " + game.name;
        sendStateToAll(lobby);
        return;
    }

    gameState.status = GameStatus.waitingforhost;

    // if config does not provide a specific url for the host,
    // just use the same one for the host as other players
    if (!gameState.joinGameURL.hostURL) {
        gameState.joinGameURL.hostURL = gameState.joinGameURL.playerURL;
    }

    const host = getHost(playerList);
    host.socket.once("host-game-loaded", () => {
        gameState.status = GameStatus.inprogress;
        sendStateToAll(lobby);
    });

    sendStateToAll(lobby);
};

export const exitGame = (lobby: Lobby): void => {
    lobby.status = LobbyStatus.lobby;

    const { gameState } = lobby;
    gameState.status = GameStatus.loading;
    gameState.joinGameURL = { playerURL: "", hostURL: "" };
};

const findPlayerByName = (
    nameToFind: string,
    playerList: Array<Player>
): Player => playerList.find(({ name }) => name === nameToFind);

const findGameById = (gameId: string): ServerGame =>
    SERVER_GAME_LIST.find(({ id }) => id === gameId);

const disconnectAllPlayers = (playerList: Array<Player>): void =>
    playerList.forEach(({ socket }) => socket.disconnect(true));

const getJsonLobby = ({ playerList, ...lobby }: Lobby) => ({
    playerList: playerList.map(({ id, name, isHost }) => ({
        id,
        name,
        isHost,
    })),
    ...lobby,
});

const getUniqueGameCode = (ll: Array<Lobby>): string => {
    let newCode;
    do {
        newCode = getRandomFourLetters();
    } while (ll.find(({ code }) => code === newCode) && newCode !== "ffff");
    return newCode;
};

const getRandomFourLetters = (): string => {
    const len = 4;
    const possible = "abcdefghijklmnopqrstuvwxyz";

    let code = "";
    for (let i = 0; i < len; i++) {
        code += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return code;
};

const deleteFromArray = (item: any, array: Array<any>): void => {
    const index = array.indexOf(item);
    if (index > -1) {
        array.splice(index, 1);
    }
};

const isIDinUse = (previousId: number, playerList: Array<Player>): boolean =>
    !!playerList.find(({ id }) => id === previousId);

const setHost = (idealHostId: number, playerList: Array<Player>): void => {
    playerList.forEach((player) => (player.isHost = false));

    const idealHost = playerList.find(({ id }) => id === idealHostId);

    if (idealHost) {
        idealHost.isHost = true;
        return;
    }

    // make the player with the lowest id the host
    playerList.reduce((acc, cur) => (acc.id < cur.id ? acc : cur), {
        id: Number.MAX_SAFE_INTEGER,
        isHost: null,
    }).isHost = true;
};

const getHost = (playerList: Array<Player>): Player =>
    playerList.find(({ isHost }) => isHost);
