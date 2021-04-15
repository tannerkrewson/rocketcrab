import {
    RocketCrab,
    Party,
    Player,
    ServerGame,
    ClientParty,
    FinderState,
    FINDER_ACTIVE_MS,
    MAX_CHATS_OVERALL,
    MAX_CHATS_FROM_SINGLE_PLAYER,
} from "../types/types";
import {
    PartyStatus,
    GameStatus,
    SocketEvent,
    RocketcrabMode,
} from "../types/enums";
import { getServerGameLibrary } from "../config";
import { v4 as uuidv4 } from "uuid";
import { CronJob } from "cron";
import { getUnixTime } from "date-fns";
import { isChatMsgValid } from "../utils/utils";

const SERVER_GAME_LIST: Array<ServerGame> = getServerGameLibrary().gameList;
const PARTY_EXPIRATION_SEC = 60;

export const initRocketCrab = (isDevMode?: boolean): RocketCrab => {
    const partyList: Array<Party> = [];

    const rocketcrab = {
        partyList,
        isFinderActive: false,
        finderSubscribers: [],
    };

    if (isDevMode) newParty({ rocketcrab, forceGameCode: "ffff" });

    return rocketcrab;
};

export const initCron = (rocketcrab: RocketCrab): void => {
    const setDates = () => {
        rocketcrab.finderActiveDates = {
            lastStart: getUnixTime(activateFinderJob.lastDate()) * 1000,
            nextStart: activateFinderJob.nextDate().valueOf(),
            nextWeekOfStarts: activateFinderJob
                .nextDates(24)
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                .map((momentDate) => momentDate.valueOf()),
        };
    };

    const activateFinderJob = new CronJob(
        "0 13 * * 6", // https://crontab.guru/#0_13_*_*_6
        () => {
            setDates();
            rocketcrab.isFinderActive = true;
            sendFinderStateToAll(rocketcrab);

            setTimeout(() => {
                rocketcrab.isFinderActive = false;

                // ensure that a long-lived party is not shown on a subsequent
                // activation of the finder
                rocketcrab.partyList.forEach((party) => {
                    if (!party.isPublic) return;

                    party.isPublic = false;
                    sendStateToAll(party, rocketcrab, {
                        enableFinderCheck: false,
                    });
                });
                sendFinderStateToAll(rocketcrab);
            }, FINDER_ACTIVE_MS);
        },
        null,
        true,
        "America/Chicago"
    );

    setDates();
};

export const newParty = ({
    rocketcrab: { partyList, finderActiveDates },
    forceGameCode,
    forceUuid,
    isPublic = false,
    mode = RocketcrabMode.MAIN,
}: {
    rocketcrab: RocketCrab;
    forceGameCode?: string;
    forceUuid?: string;
    isPublic?: boolean;
    mode?: RocketcrabMode;
}): Party => {
    const newParty: Party = {
        status: PartyStatus.party,
        playerList: [],
        code: forceGameCode || getUniqueGameCode(partyList),
        uuid: forceUuid || uuidv4(),
        selectedGameId: "",
        gameState: {
            status: GameStatus.loading,
        },
        nextPlayerId: 0,
        idealHostId: 0,
        isPublic,
        createdAsPublic: isPublic,
        chat: [],
        bannedIPs: [],
        mode,
    };

    if (isPublic) {
        newParty.publicEndDate = finderActiveDates.lastStart + FINDER_ACTIVE_MS;
    }

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

export const getPartyByUuid = (newUuid: string, partyList: Party[]): Party =>
    partyList.find(({ uuid }) => uuid === newUuid);

export const reconnectToParty = (
    lastPartyState: ClientParty,
    rocketcrab: RocketCrab
): Party => {
    const { partyList } = rocketcrab;

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
        rocketcrab,
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
    party.playerList.forEach(({ socket, ...player }) => {
        const clientParty: ClientParty = {
            me: player,
            ...getJsonParty(party),
            isFinderActive: rocketcrab.isFinderActive,
        };
        socket.emit(SocketEvent.UPDATE, clientParty);
    });

    if (
        (enableFinderCheck && shouldSendFinderStateUpdate(party, rocketcrab)) ||
        forceFinderUpdate
    ) {
        sendFinderStateToAll(rocketcrab);
    }
};

export const sendFinderStateToAll = (rocketcrab: RocketCrab): void => {
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
    rocketcrab: RocketCrab
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
        gameState.connectedGame = await game.connectToGame();
    } catch (e) {
        console.error(e);

        gameState.status = GameStatus.error;
        gameState.error = "❌ Can't connect to " + game.name;
        sendStateToAll(party, rocketcrab);
        return;
    }

    gameState.status = GameStatus.waitingforhost;

    const host = getHost(playerList);

    const onHostGameLoaded = () => {
        gameState.status = GameStatus.inprogress;
        sendStateToAll(party, rocketcrab);
    };

    // if, for some unknown reason, the host doesn't send this event, we'll
    // just assume they're good after 10 seconds.
    // added this because people were getting stuck on "Waiting for host..."
    const hostGameLoadedBackup = setTimeout(onHostGameLoaded, 10 * 1000);

    host.socket.once(SocketEvent.HOST_GAME_LOADED, () => {
        clearTimeout(hostGameLoadedBackup);
        onHostGameLoaded();
    });

    sendStateToAll(party, rocketcrab);
};

export const exitGame = (party: Party): void => {
    party.status = PartyStatus.party;

    const { gameState } = party;
    gameState.status = GameStatus.loading;
    delete gameState.connectedGame;
    delete gameState.error;
};

export const getFinderState = ({
    isFinderActive,
    partyList,
    finderActiveDates,
    finderSubscribers,
}: RocketCrab): FinderState => ({
    isActive: isFinderActive,
    publicPartyList: partyList
        .filter(
            ({ isPublic, status, selectedGameId }) =>
                isPublic && status === PartyStatus.party && selectedGameId
        )
        .map((party) => getJsonParty(party)),
    finderActiveDates,
    subscriberCount: finderSubscribers.length - 1, // not counting the person it's being sent to
});

export const addChatMessage = (
    message: string,
    player: Player,
    party: Party
): boolean => {
    if (!isChatMsgValid(message, player, party.chat)) return false;

    party.chat.push({
        playerId: player.id,
        playerName: player.name,
        message,
        date: Date.now().valueOf(),
    });

    purgeOverflowMsgs(player, party);

    return true;
};

export const kickPlayer = (
    playerId: number,
    isBan: boolean,
    party: Party
): void => {
    const playerToKick = party.playerList.find(({ id }) => id === playerId);

    if (!playerToKick) return;

    if (isBan) {
        party.bannedIPs.push(playerToKick.socket.handshake.address);
    }

    removePlayer(playerToKick, party);
};

const purgeOverflowMsgs = (player: Player, party: Party): void => {
    const numberOfMsgsFromThisPlayer = party.chat.reduce(
        (prev, cur) => prev + (cur.playerId === player.id ? 1 : 0),
        0
    );

    let numberOfMsgsToRemove =
        numberOfMsgsFromThisPlayer - MAX_CHATS_FROM_SINGLE_PLAYER;

    if (numberOfMsgsToRemove > 0) {
        // removes from the beginning, which will be the oldest msgs
        party.chat = party.chat.filter(({ playerId }) => {
            if (playerId === player.id && numberOfMsgsToRemove > 0) {
                numberOfMsgsToRemove--;
                return false;
            }
            return true;
        });
    }

    // remove overflow from the beginning (oldest)
    if (party.chat.length > MAX_CHATS_OVERALL) {
        party.chat.splice(0, party.chat.length - MAX_CHATS_OVERALL);
    }
};

const findPlayerByName = (
    nameToFind: string,
    playerList: Array<Player>
): Player => playerList.find(({ name }) => name === nameToFind);

const findGameById = (gameId: string): ServerGame =>
    SERVER_GAME_LIST.find(({ id }) => id === gameId);

const disconnectAllPlayers = (playerList: Array<Player>): void =>
    playerList.forEach(({ socket }) => socket.disconnect(true));

export const getJsonParty = ({ playerList, ...party }: Party): ClientParty => ({
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
