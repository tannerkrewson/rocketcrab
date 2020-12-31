import {
    initRocketCrab,
    newParty,
    addPlayer,
    sendStateToAll,
    removePlayer,
    deletePartyIfEmpty,
    setGame,
    setName,
    startGame,
    exitGame,
    getPartyByCode,
    getPartyByUuid,
    reconnectToParty,
} from "../../server/rocketcrab";
import {
    Party,
    GameState,
    Player,
    ServerGameLibrary,
    ServerGame,
    RocketCrab,
} from "../../types/types";
import { PartyStatus, GameStatus, SocketEvent } from "../../types/enums";

jest.mock("../../config", () => ({
    getServerGameLibrary: jest.fn(
        (): ServerGameLibrary => ({
            gameList: [
                {
                    id: "jd-foogame",
                    name: "FooGame",
                    getJoinGameUrl: async () => ({
                        playerURL: "foogame.com",
                    }),
                } as ServerGame,
                { id: "lk-coolgame", name: "CoolGame" } as ServerGame,
            ],
            categories: [],
        })
    ),
    getClientGameLibrary: jest.fn(() => ({
        gameList: [{ name: "FooGame" }, { name: "CoolGame" }],
        categories: [],
    })),
}));

describe("server/rocketcrab.ts", () => {
    it("initRocketCrab works", () => {
        expect(initRocketCrab()).toStrictEqual({
            partyList: [],
            isFinderActive: true,
            finderSubscribers: [],
        });
    });

    it("newParty works", () => {
        const partyList: Array<Party> = [];

        newParty({ partyList });

        expect(partyList.length).toBe(1);
        expect(partyList[0].status).toBe(PartyStatus.party);
        expect(partyList[0].code.length).toBe(4);
        expect(partyList[0].uuid.length).toBe(36);
        expect(partyList[0].playerList.length).toBe(0);
    });

    it("newParty works with forced code & uuid", () => {
        const partyList: Array<Party> = [];

        newParty({ partyList, forceGameCode: "abcd", forceUuid: "cool-uuid" });

        expect(partyList.length).toBe(1);
        expect(partyList[0].status).toBe(PartyStatus.party);
        expect(partyList[0].code).toBe("abcd");
        expect(partyList[0].uuid).toBe("cool-uuid");
        expect(partyList[0].playerList.length).toBe(0);
    });

    it("getPartyByCode finds existing party", () => {
        const partyList: Array<Party> = [];

        const { code } = newParty({ partyList });
        const party = getPartyByCode(code, partyList);

        expect(party.code).toBe(code);
    });

    it("getPartyByCode doesn't find non-existent party", () => {
        const partyList: Array<Party> = [];
        const code = "abcd";

        const party = getPartyByCode(code, partyList);

        expect(party).toBeFalsy();
    });

    it("getPartyByUuid finds existing party", () => {
        const partyList: Array<Party> = [];

        const { uuid } = newParty({ partyList });
        const party = getPartyByUuid(uuid, partyList);

        expect(party.uuid).toBe(uuid);
    });

    it("getPartyByUuid doesn't find non-existent party", () => {
        const partyList: Array<Party> = [];
        const uuid = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

        const party = getPartyByUuid(uuid, partyList);

        expect(party).toBeFalsy();
    });

    it("addPlayer works", () => {
        const mockParty: Party = generateMockParty({ nextPlayerId: 0 });
        const { playerList } = mockParty;

        const mockSocket0 = {} as SocketIO.Socket;
        const mockPlayer0 = addPlayer("foo", mockSocket0, mockParty);

        expect(playerList.length).toBe(1);

        const mockSocket1 = {} as SocketIO.Socket;
        const mockPlayer1 = addPlayer("bar", mockSocket1, mockParty);

        expect(playerList.length).toBe(2);

        expect(playerList).toContain(mockPlayer0);
        expect(playerList[0].id).toBe(0);
        expect(playerList[0].name).toBe("foo");
        expect(playerList[0].socket).toBe(mockSocket0);
        expect(playerList[0].isHost).toBe(true);
        expect(mockParty.idealHostId).toBe(0);

        expect(playerList).toContain(mockPlayer1);
        expect(playerList[1].id).toBe(1);
        expect(playerList[1].name).toBe("bar");
        expect(playerList[1].socket).toBe(mockSocket1);
        expect(playerList[1].isHost).toBe(false);
        expect(mockParty.idealHostId).toBe(0);
    });

    it("addPlayer uses previousId if valid", () => {
        const playerList = [generateMockPlayer({ id: 1 })];
        const mockParty: Party = generateMockParty({
            playerList,
            nextPlayerId: 2,
        });

        const mockSocket = {} as SocketIO.Socket;
        addPlayer("bar", mockSocket, mockParty, 0);

        expect(playerList[1].id).toBe(0);
    });

    it("addPlayer doesn't use previousId if it's invalid", () => {
        const playerList = [generateMockPlayer({ id: 0, isHost: true })];
        const mockParty: Party = generateMockParty({ playerList });

        const mockSocket = {} as SocketIO.Socket;
        addPlayer("bar", mockSocket, mockParty, 0);

        expect(playerList[0].id).toBe(0);
        expect(playerList[1].id).toBe(1);
    });

    it("addPlayer sets nextPlayerId if it's too low", () => {
        const mockParty: Party = generateMockParty({
            nextPlayerId: 0,
        });

        const mockSocket = {} as SocketIO.Socket;
        addPlayer("foo", mockSocket, mockParty, 100);

        const { playerList } = mockParty;
        expect(playerList[0].id).toBe(100);

        expect(mockParty.nextPlayerId).toBe(101);
    });

    it("sendStateToAll works", () => {
        const emits = [jest.fn(), jest.fn(), jest.fn()];
        const mockParty: Party = generateMockParty({
            playerList: generateMockPlayerList(3, (player, i) => ({
                ...player,
                socket: { emit: emits[i] } as Partial<SocketIO.Socket>,
            })),
        });
        const mocketCrab = generateMocketCrab({});

        sendStateToAll(mockParty, mocketCrab);

        const jsonPlayerList = [
            {
                id: 0,
                name: "name0",
                isHost: true,
            },
            {
                id: 1,
                name: "name1",
                isHost: false,
            },
            {
                id: 2,
                name: "name2",
                isHost: false,
            },
        ];
        const jsonParty = generateMockParty({ playerList: jsonPlayerList });

        expect(emits[0]).toBeCalledWith(SocketEvent.UPDATE, {
            ...jsonParty,
            me: jsonPlayerList[0],
        });
        expect(emits[1]).toBeCalledWith(SocketEvent.UPDATE, {
            ...jsonParty,
            me: jsonPlayerList[1],
        });
        expect(emits[2]).toBeCalledWith(SocketEvent.UPDATE, {
            ...jsonParty,
            me: jsonPlayerList[2],
        });
    });

    it("sendStateToAll sends a finder update if enabled", () => {
        const emits = [jest.fn(), jest.fn(), jest.fn()];

        const generateMocket = (i: number) =>
            (({
                emit: emits[i],
            } as Partial<SocketIO.Socket>) as SocketIO.Socket);

        const mockParty: Party = generateMockParty({
            status: PartyStatus.party,
            isPublic: true,
        });
        const mocketCrab = generateMocketCrab({
            isFinderActive: true,
            finderSubscribers: [
                generateMocket(0),
                generateMocket(1),
                generateMocket(2),
            ],
        });

        sendStateToAll(mockParty, mocketCrab, { enableFinderCheck: true });

        expect(emits[0]).toBeCalled();
        expect(emits[1]).toBeCalled();
        expect(emits[2]).toBeCalled();
    });

    it("sendStateToAll sends a finder update if forced", () => {
        const emits = [jest.fn()];

        const generateMocket = (i: number) =>
            (({
                emit: emits[i],
            } as Partial<SocketIO.Socket>) as SocketIO.Socket);

        const mockParty: Party = generateMockParty({
            status: PartyStatus.ingame,
            isPublic: false,
        });
        const mocketCrab = generateMocketCrab({
            isFinderActive: true,
            finderSubscribers: [generateMocket(0)],
        });

        sendStateToAll(mockParty, mocketCrab, { forceFinderUpdate: true });

        expect(emits[0]).toBeCalled();
    });

    it("removePlayer works", () => {
        const disconnect = jest.fn();
        const mockPlayer = generateMockPlayer({
            socket: ({ disconnect } as unknown) as SocketIO.Socket,
        });

        const playerList = [mockPlayer];
        const mockParty: Party = generateMockParty({
            playerList,
        });

        removePlayer(mockPlayer, mockParty);

        expect(playerList.length).toBe(0);
        expect(playerList).not.toContain(mockPlayer);
        expect(disconnect).toHaveBeenCalledWith(true);
    });

    it("removePlayer sets new host", () => {
        const mockParty: Party = generateMockParty({
            playerList: generateMockPlayerList(2, (player) => ({
                ...player,
                socket: {
                    disconnect: jest.fn(),
                } as Partial<SocketIO.Socket>,
            })),
        });

        const playerToRemove = mockParty.playerList[0];
        removePlayer(playerToRemove, mockParty);

        expect(mockParty.playerList.length).toBe(1);
        expect(mockParty.playerList).not.toContain(playerToRemove);
        expect(mockParty.playerList[0].isHost).toBe(true);
        expect(mockParty.idealHostId).toBe(0);
    });

    it("deletePartyIfEmpty deletes empty party", () => {
        const mockParty: Party = generateMockParty({});
        const partyList: Array<Party> = [mockParty];

        deletePartyIfEmpty(mockParty, partyList);

        expect(partyList.length).toBe(0);
    });

    it("deletePartyIfEmpty doesn't delete non-empty party", () => {
        const mockParty: Party = generateMockParty({
            playerList: generateMockPlayerList(1),
        });
        const partyList: Array<Party> = [mockParty];

        deletePartyIfEmpty(mockParty, partyList);

        expect(partyList).toContain(mockParty);
    });

    it("setGame works", () => {
        const mockParty: Party = generateMockParty({
            playerList: generateMockPlayerList(1),
        });

        setGame("lk-coolgame", mockParty);

        expect(mockParty.selectedGameId).toBe("lk-coolgame");
    });

    it("setName works", () => {
        const mockPlayerList = generateMockPlayerList(4, (player, i) => ({
            ...player,
            name: i === 0 ? "" : player.name,
        }));

        setName("Bob", mockPlayerList[0], mockPlayerList);

        expect(mockPlayerList[0].name).toBe("Bob");
    });

    it("setName fails if name already in use", () => {
        const mockPlayerList = generateMockPlayerList(4, (player, i) => ({
            ...player,
            name: i === 0 ? "" : player.name,
            socket: { emit: jest.fn() } as Partial<SocketIO.Socket>,
        }));

        setName("name1", mockPlayerList[0], mockPlayerList);

        expect(mockPlayerList[0].name).toBe("");
        expect(mockPlayerList[0].socket.emit).toBeCalledWith(
            SocketEvent.INVALID_NAME
        );
    });

    it("startGame works", async () => {
        const mockParty = generateMockParty({
            status: PartyStatus.party,
            selectedGameId: "jd-foogame",
            gameState: {
                status: undefined,
            },
            playerList: generateMockPlayerList(1, (player) => ({
                ...player,
                socket: ({
                    emit: jest.fn(),
                    once: jest.fn(),
                } as unknown) as SocketIO.Socket,
            })),
        });

        const mocketCrab = generateMocketCrab({});

        await startGame(mockParty, mocketCrab);

        expect(mockParty.status).toBe(PartyStatus.ingame);
        expect(mockParty.gameState.status).toBe(GameStatus.waitingforhost);

        // TODO: test call to getJoinGameUrl
    });

    it("startGame fails if game doesn't exist", () => {
        const mockParty = generateMockParty({
            status: PartyStatus.party,
            selectedGameId: "GameThatDoesntExist",
            gameState: {
                status: undefined,
            },
        });

        startGame(mockParty);

        expect(mockParty.status).toBe(PartyStatus.party);
        expect(mockParty.gameState.status).toBeUndefined();
    });

    it("exitGame works", () => {
        const mockParty = generateMockParty({
            status: PartyStatus.ingame,
            selectedGameId: "FooGame",
            gameState: {
                status: GameStatus.inprogress,
                joinGameURL: {
                    playerURL: "test.com",
                    hostURL: "host.com",
                },
            },
        });

        exitGame(mockParty);

        expect(mockParty.status).toBe(PartyStatus.party);
        expect(mockParty.gameState.status).toBe(GameStatus.loading);
        expect(mockParty.gameState.joinGameURL.playerURL).toBe("");
        expect(mockParty.gameState.joinGameURL.hostURL).toBe("");
    });

    it("reconnectToParty uses matching existing party", () => {
        const existingParty = generateMockParty({});
        const partyList = [existingParty];
        const newParty = reconnectToParty(existingParty, partyList);

        expect(newParty.uuid).toBe(existingParty.uuid);
        expect(partyList.length).toBe(1);
    });

    it("reconnectToParty creates identical party", () => {
        const partyToRecreate = generateMockParty({ nextPlayerId: 0 });
        const partyList = [];
        const actualParty = reconnectToParty(partyToRecreate, partyList);

        expect(actualParty).toMatchObject(partyToRecreate);
    });

    it("reconnectToParty generates new code if already in use", () => {
        const partyToRecreate = generateMockParty({
            nextPlayerId: 0,
            code: "abcd",
            uuid: "1",
        });
        const existingParty = generateMockParty({ code: "abcd", uuid: "2" });
        const partyList = [existingParty];
        const actualParty = reconnectToParty(partyToRecreate, partyList);

        expect(actualParty.code).not.toBe("abcd");
    });

    it("reconnectToParty returns undefined if no lastPartyState given", () => {
        const partyList = [];
        const newParty = reconnectToParty(undefined, partyList);

        expect(newParty).toBeUndefined();
        expect(partyList.length).toBe(0);
    });
});

const generateMocketCrab = ({
    partyList = [],
    isFinderActive = false,
    finderSubscribers = [],
}: Partial<RocketCrab>): RocketCrab => ({
    partyList,
    isFinderActive,
    finderSubscribers,
});

const generateMockParty = ({
    status = PartyStatus.party,
    playerList = [],
    code = "efgh",
    uuid = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    selectedGameId = "jd-foogame",
    gameState = {} as GameState,
    nextPlayerId = 1,
    idealHostId = 0,
    isPublic = false,
}: Partial<Party>): Party => ({
    status,
    playerList,
    code,
    uuid,
    selectedGameId,
    gameState,
    nextPlayerId,
    idealHostId,
    isPublic,
});

const generateMockPlayer = ({
    id = 0,
    name = "foo",
    socket = {} as SocketIO.Socket,
    isHost = false,
}: Partial<Player> = {}): Player => ({
    id,
    name,
    socket,
    isHost,
});

const generateMockPlayerList = (
    numPlayers,
    modifyPlayer?: (Player, number) => Player
): Array<Player> => {
    const playerList: Array<Player> = [];
    for (let i = 0; i < numPlayers; i++) {
        const player = generateMockPlayer({
            id: i,
            name: "name" + i,
            isHost: i === 0,
        });
        playerList.push(modifyPlayer ? modifyPlayer(player, i) : player);
    }
    return playerList;
};
