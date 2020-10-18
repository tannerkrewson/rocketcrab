import {
    initRocketCrab,
    newParty,
    getParty,
    addPlayer,
    sendStateToAll,
    removePlayer,
    deletePartyIfEmpty,
    setGame,
    setName,
    startGame,
    exitGame,
} from "../../server/rocketcrab";
import {
    Party,
    GameState,
    Player,
    ServerGameLibrary,
    ServerGame,
} from "../../types/types";
import { PartyStatus, GameStatus } from "../../types/enums";

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

    it("getParty finds existing party", () => {
        const partyList: Array<Party> = [];

        const { code } = newParty({ partyList });
        const party = getParty(code, partyList);

        expect(party.code).toBe(code);
    });

    it("getParty doesn't find non-existent party", () => {
        const partyList: Array<Party> = [];
        const code = "abcd";

        const party = getParty(code, partyList);

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

        sendStateToAll(mockParty);

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
        const jsonParty = {
            status: PartyStatus.party,
            playerList: jsonPlayerList,
            code: "efgh",
            selectedGameId: "FooGame",
            gameState: {} as GameState,
            nextPlayerId: 1,
            idealHostId: 0,
        };

        expect(emits[0]).toBeCalledWith("update", {
            ...jsonParty,
            me: jsonPlayerList[0],
        });
        expect(emits[1]).toBeCalledWith("update", {
            ...jsonParty,
            me: jsonPlayerList[1],
        });
        expect(emits[2]).toBeCalledWith("update", {
            ...jsonParty,
            me: jsonPlayerList[2],
        });
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
        const mockParty: Party = generateMockParty();
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
        expect(mockPlayerList[0].socket.emit).toBeCalledWith("invalid-name");
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

        await startGame(mockParty);

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
});

const generateMockParty = ({
    status = PartyStatus.party,
    playerList = [],
    code = "efgh",
    selectedGameId = "FooGame",
    gameState = {} as GameState,
    nextPlayerId = 1,
    idealHostId = 0,
}: Partial<Party> = {}): Party => ({
    status,
    playerList,
    code,
    selectedGameId,
    gameState,
    nextPlayerId,
    idealHostId,
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
