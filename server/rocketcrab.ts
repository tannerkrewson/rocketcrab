import {
    RocketCrab,
    Party,
    Player,
    ServerGame,
    ClientParty,
    FinderState,
} from "../types/types";
import { PartyStatus, GameStatus, SocketEvent } from "../types/enums";
import { getServerGameLibrary } from "../config";
import { v4 as uuidv4 } from "uuid";
import { CronJob } from "cron";

const SERVER_GAME_LIST: Array<ServerGame> = getServerGameLibrary().gameList;
const PARTY_EXPIRATION_SEC = 60;

export const initRocketCrab = (isDevMode?: boolean): RocketCrab => {
    const partyList: Array<Party> = [];

    if (isDevMode) newParty({ partyList, forceGameCode: "ffff" });

    return { partyList, isFinderActive: false, finderSubscribers: [] };
};

export const initCron = (rocketcrab: RocketCrab): CronJob => {
    const setDates = () => {
        rocketcrab.finderActiveDates = {
            lastStart: activateFinderJob.lastDate(),
            nextStart: activateFinderJob.nextDate(),
        };
    };

    const activateFinderJob = new CronJob(
        "0 0/2 * * 4-6", // https://crontab.guru/#0_0/2_*_*_4-6
        () => {
            setDates();
            rocketcrab.isFinderActive = true;
            sendFinderStateToAll(rocketcrab);

            setTimeout(() => {
                rocketcrab.isFinderActive = false;

                // ensure that a long-lived party is not shown on a subsequent
                // activation of the finder
                rocketcrab.partyList.forEach((party) => {
                    party.isPublic = false;
                });

                sendFinderStateToAll(rocketcrab);
            }, 10 * 60 * 1000); // 10 minutes
        },
        null,
        true,
        "America/Chicago"
    );

    setDates();
};

export const newParty = ({
    partyList,
    forceGameCode,
    forceUuid,
    isPublic = false,
}: {
    partyList: Array<Party>;
    forceGameCode?: string;
    forceUuid?: string;
    isPublic?: boolean;
}): Party => {
    const newParty: Party = {
        status: PartyStatus.party,
        playerList: [],
        code: forceGameCode || getUniqueGameCode(partyList),
        uuid: forceUuid || uuidv4(),
        selectedGameId: "",
        gameState: {
            status: GameStatus.loading,
            joinGameURL: { playerURL: "", hostURL: "" },
        },
        nextPlayerId: 0,
        idealHostId: 0,
        isPublic,
    };
    partyList.push(newParty);

    setTimeout(
        () => deletePartyIfEmpty(newParty, partyList),
        PARTY_EXPIRATION_SEC * 1000
    );

    return newParty;
};

export const getPartyByCode = (
    newCode: string,
    partyList: Array<Party>
): Party => partyList.find(({ code }) => code === newCode);

export const getPartyByUuid = (
    newUuid: string,
    partyList: Array<Party>
): Party => partyList.find(({ uuid }) => uuid === newUuid);

export const reconnectToParty = (
    lastPartyState: ClientParty,
    partyList: Array<Party>
): Party => {
    if (!lastPartyState || !lastPartyState.uuid) return;

    const { code, uuid, status, selectedGameId, gameState, idealHostId } =
        lastPartyState || {};

    const partyAlreadyExists = getPartyByUuid(uuid, partyList);
    if (partyAlreadyExists) return partyAlreadyExists;

    const isValidCode =
        code?.length === 4 &&
        code?.match(/[a-z]/i) &&
        !getPartyByCode(code, partyList);

    const party = newParty({
        partyList,
        forceUuid: uuid,
        ...(isValidCode ? { forceGameCode: code } : {}),
    });

    if (Object.values(PartyStatus).includes(status)) {
        party.status = status;
    }

    if (findGameById(selectedGameId)) {
        party.selectedGameId = selectedGameId;
    }

    party.gameState = gameState;
    party.idealHostId = idealHostId;

    return party;
};

export const addPlayer = (
    name: string,
    socket: SocketIO.Socket,
    party: Party,
    previousId?: number
): Player => {
    const { playerList } = party;

    const idNotInUse = !isIDinUse(previousId, party.playerList);
    const usePreviousId =
        Number.isInteger(previousId) && previousId >= 0 && idNotInUse;
    const id = usePreviousId ? previousId : party.nextPlayerId++;

    const isFirstPlayer = playerList.length === 0;

    // this is mostly only important for the ffff dev party
    // in which ids are previousIds that were not created
    // in this instance of the party are being used.
    // also important for reconnectToParty.
    if (id >= party.nextPlayerId) {
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

export const sendStateToAll = (
    party: Party,
    rocketcrab: RocketCrab,
    {
        enableFinderCheck,
        forceFinderUpdate,
    }: { enableFinderCheck?: boolean; forceFinderUpdate?: boolean } = {}
): void => {
    party.playerList.forEach(({ socket, ...player }) =>
        socket.emit(SocketEvent.UPDATE, { me: player, ...getJsonParty(party) })
    );

    if (
        (enableFinderCheck && shouldSendFinderStateUpdate(party, rocketcrab)) ||
        forceFinderUpdate
    ) {
        sendFinderStateToAll(rocketcrab);
    }
};

const sendFinderStateToAll = (rocketcrab: RocketCrab): void => {
    rocketcrab.finderSubscribers.forEach((socket) =>
        socket.emit(SocketEvent.FINDER_UPDATE, getFinderState(rocketcrab))
    );
};

export const shouldSendFinderStateUpdate = (
    { status, isPublic }: Party,
    { isFinderActive }: RocketCrab
): boolean => {
    const thisPartyIsShownOnFinder = status === PartyStatus.party && isPublic;

    return isFinderActive && thisPartyIsShownOnFinder;
};

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
            playerToName.socket.emit(SocketEvent.INVALID_NAME);
        }
    }
};

export const setGame = (gameId: string, party: Party): void => {
    if (findGameById(gameId)) {
        party.selectedGameId = gameId;
    }
};

export const startGame = async (
    party: Party,
    rocketcrab?: RocketCrab
): Promise<void> => {
    // TODO: check if ready
    const { gameState, selectedGameId, playerList } = party;

    const willSendFinderUpdate = shouldSendFinderStateUpdate(party, rocketcrab);
    party.status === PartyStatus.party && party.isPublic;

    const game: ServerGame = findGameById(selectedGameId);
    if (!game) return;

    party.status = PartyStatus.ingame;
    gameState.status = GameStatus.loading;

    sendStateToAll(party, rocketcrab, {
        forceFinderUpdate: willSendFinderUpdate,
    });

    try {
        gameState.joinGameURL = await game.getJoinGameUrl();
    } catch (e) {
        console.error(e);

        gameState.status = GameStatus.error;
        gameState.error = "❌ Can't connect to " + game.name;
        sendStateToAll(party, rocketcrab);
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
        sendStateToAll(party, rocketcrab);
    });

    sendStateToAll(party, rocketcrab);
};

export const exitGame = (party: Party): void => {
    party.status = PartyStatus.party;

    const { gameState } = party;
    gameState.status = GameStatus.loading;
    gameState.joinGameURL = { playerURL: "", hostURL: "" };
};

export const getFinderState = ({
    isFinderActive,
    partyList,
    finderActiveDates,
}: RocketCrab): FinderState => ({
    isActive: isFinderActive,
    publicPartyList: partyList
        .filter(
            ({ isPublic, status }) => isPublic && status === PartyStatus.party
        )
        .map((party) => getJsonParty(party)),
    finderActiveDates,
});

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
