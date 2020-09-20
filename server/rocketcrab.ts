import { RocketCrab, Party, Player, ServerGame } from "../types/types";
import { PartyStatus, GameStatus } from "../types/enums";
import { getServerGameLibrary } from "../config";
const SERVER_GAME_LIST: Array<ServerGame> = getServerGameLibrary().gameList;

export const initRocketCrab = (isDevMode?: boolean): RocketCrab => {
    const partyList: Array<Party> = [];

    if (isDevMode) newParty(partyList, "ffff");

    return { partyList };
};

export const newParty = (
    partyList: Array<Party>,
    gameCode?: string,
    uuid?: string
): Party => {
    const code: string = gameCode || getUniqueGameCode(partyList);
    const newParty: Party = {
        status: PartyStatus.party,
        playerList: [],
        code,
        uuid,
        selectedGameId: "",
        gameState: {
            status: GameStatus.loading,
            joinGameURL: { playerURL: "", hostURL: "" },
        },
        nextPlayerId: 0,
        idealHostId: 0,
    };
    partyList.push(newParty);
    return newParty;
};

export const getParty = (newCode: string, partyList: Array<Party>): Party =>
    partyList.find(({ code }) => code === newCode);

export const addPlayer = (
    name: string,
    socket: SocketIO.Socket,
    party: Party,
    previousId?: number
): Player => {
    const { playerList } = party;

    const idNotInUse = !isIDinUse(previousId, party.playerList);
    const usePreviousId = Number.isInteger(previousId) && idNotInUse;
    const id = usePreviousId ? previousId : party.nextPlayerId++;

    const isFirstPlayer = playerList.length === 0;

    // this is mostly only important for the ffff dev party
    // in which ids are previousIds that were not created
    // in this instance of the party are being used
    if (id > party.nextPlayerId) {
        party.nextPlayerId = id + 1;
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
        party.idealHostId = id;
    }

    setHost(party.idealHostId, playerList);

    return player;
};

export const sendStateToAll = (party: Party): void =>
    party.playerList.forEach(({ socket, ...player }) =>
        socket.emit("update", { me: player, ...getJsonParty(party) })
    );

export const removePlayer = (player: Player, party: Party): void => {
    const { playerList, idealHostId } = party;
    const { socket } = player;

    if (socket && socket.disconnect) {
        socket.disconnect(true);
    }

    deleteFromArray(player, playerList);

    if (player.isHost) {
        setHost(idealHostId, playerList);
    }
};

export const deletePartyIfEmpty = (
    party: Party,
    partyList: Array<Party>
): void => {
    const { playerList, code } = party;

    if (playerList.length === 0 && code !== "ffff") {
        // the only players that could possibly
        // be left are unnamed players
        disconnectAllPlayers(playerList);

        deleteFromArray(party, partyList);
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

export const setGame = (gameId: string, party: Party): void => {
    if (findGameById(gameId)) {
        party.selectedGameId = gameId;
    }
};

export const startGame = async (party: Party): Promise<void> => {
    // TODO: check if ready
    const { gameState, selectedGameId, playerList } = party;

    const game: ServerGame = findGameById(selectedGameId);
    if (!game) return;

    party.status = PartyStatus.ingame;
    gameState.status = GameStatus.loading;
    sendStateToAll(party);

    try {
        gameState.joinGameURL = await game.getJoinGameUrl();
    } catch (e) {
        console.error(e);

        gameState.status = GameStatus.error;
        gameState.error = "❌ Can't connect to " + game.name;
        sendStateToAll(party);
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
        sendStateToAll(party);
    });

    sendStateToAll(party);
};

export const exitGame = (party: Party): void => {
    party.status = PartyStatus.party;

    const { gameState } = party;
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

const getJsonParty = ({ playerList, ...party }: Party) => ({
    playerList: playerList.map(({ id, name, isHost }) => ({
        id,
        name,
        isHost,
    })),
    ...party,
});

const getUniqueGameCode = (ll: Array<Party>): string => {
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
