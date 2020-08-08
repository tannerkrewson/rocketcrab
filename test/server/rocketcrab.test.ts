import {
    initRocketCrab,
    newLobby,
    getLobby,
    addPlayer,
    sendStateToAll,
    removePlayer,
    deleteLobbyIfEmpty,
    setGame,
    setName,
    startGame,
    exitGame,
} from "../../server/rocketcrab";
import {
    Lobby,
    GameState,
    Player,
    ServerGameLibrary,
    ServerGame,
} from "../../types/types";
import { LobbyStatus, GameStatus } from "../../types/enums";

jest.mock("../../config", () => ({
    getServerGameLibrary: jest.fn(
        (): ServerGameLibrary => ({
            gameList: [
                {
                    name: "FooGame",
                    getJoinGameUrl: async () => ({
                        playerURL: "foogame.com",
                    }),
                } as ServerGame,
                { name: "CoolGame" } as ServerGame,
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
            lobbyList: [],
        });
    });

    it("newLobby works", () => {
        const lobbyList: Array<Lobby> = [];

        newLobby(lobbyList);

        expect(lobbyList.length).toBe(1);
        expect(lobbyList[0].status).toBe(LobbyStatus.lobby);
        expect(lobbyList[0].code.length).toBe(4);
        expect(lobbyList[0].playerList.length).toBe(0);
    });

    it("newLobby works with custom code", () => {
        const lobbyList: Array<Lobby> = [];

        newLobby(lobbyList, "abcd");

        expect(lobbyList.length).toBe(1);
        expect(lobbyList[0].status).toBe(LobbyStatus.lobby);
        expect(lobbyList[0].code).toBe("abcd");
        expect(lobbyList[0].playerList.length).toBe(0);
    });

    it("getLobby finds existing lobby", () => {
        const lobbyList: Array<Lobby> = [];

        const code = newLobby(lobbyList);
        const lobby = getLobby(code, lobbyList);

        expect(lobby.code).toBe(code);
    });

    it("getLobby doesn't find non-existent lobby", () => {
        const lobbyList: Array<Lobby> = [];
        const code = "abcd";

        const lobby = getLobby(code, lobbyList);

        expect(lobby).toBeFalsy();
    });

    it("addPlayer works", () => {
        const mockLobby: Lobby = generateMockLobby({ nextPlayerId: 0 });
        const { playerList } = mockLobby;

        const mockSocket0 = {} as SocketIO.Socket;
        const mockPlayer0 = addPlayer("foo", mockSocket0, mockLobby);

        expect(playerList.length).toBe(1);

        const mockSocket1 = {} as SocketIO.Socket;
        const mockPlayer1 = addPlayer("bar", mockSocket1, mockLobby);

        expect(playerList.length).toBe(2);

        expect(playerList).toContain(mockPlayer0);
        expect(playerList[0].id).toBe(0);
        expect(playerList[0].name).toBe("foo");
        expect(playerList[0].socket).toBe(mockSocket0);
        expect(playerList[0].isHost).toBe(true);
        expect(mockLobby.idealHostId).toBe(0);

        expect(playerList).toContain(mockPlayer1);
        expect(playerList[1].id).toBe(1);
        expect(playerList[1].name).toBe("bar");
        expect(playerList[1].socket).toBe(mockSocket1);
        expect(playerList[1].isHost).toBe(false);
        expect(mockLobby.idealHostId).toBe(0);
    });

    it("addPlayer uses previousId if valid", () => {
        const playerList = [generateMockPlayer({ id: 1 })];
        const mockLobby: Lobby = generateMockLobby({
            playerList,
            nextPlayerId: 2,
        });

        const mockSocket = {} as SocketIO.Socket;
        addPlayer("bar", mockSocket, mockLobby, 0);

        expect(playerList[1].id).toBe(0);
    });

    it("addPlayer doesn't use previousId if it's invalid", () => {
        const playerList = [generateMockPlayer({ id: 0, isHost: true })];
        const mockLobby: Lobby = generateMockLobby({ playerList });

        const mockSocket = {} as SocketIO.Socket;
        addPlayer("bar", mockSocket, mockLobby, 0);

        expect(playerList[0].id).toBe(0);
        expect(playerList[1].id).toBe(1);
    });

    it("addPlayer sets nextPlayerId if it's too low", () => {
        const mockLobby: Lobby = generateMockLobby({
            nextPlayerId: 0,
        });

        const mockSocket = {} as SocketIO.Socket;
        addPlayer("foo", mockSocket, mockLobby, 100);

        const { playerList } = mockLobby;
        expect(playerList[0].id).toBe(100);

        expect(mockLobby.nextPlayerId).toBe(101);
    });

    it("sendStateToAll works", () => {
        const emits = [jest.fn(), jest.fn(), jest.fn()];
        const mockLobby: Lobby = generateMockLobby({
            playerList: generateMockPlayerList(3, (player, i) => ({
                ...player,
                socket: { emit: emits[i] } as Partial<SocketIO.Socket>,
            })),
        });

        sendStateToAll(mockLobby);

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
        const jsonLobby = {
            status: LobbyStatus.lobby,
            playerList: jsonPlayerList,
            code: "efgh",
            selectedGame: "FooGame",
            gameState: {} as GameState,
            nextPlayerId: 1,
            idealHostId: 0,
        };

        expect(emits[0]).toBeCalledWith("update", {
            ...jsonLobby,
            me: jsonPlayerList[0],
        });
        expect(emits[1]).toBeCalledWith("update", {
            ...jsonLobby,
            me: jsonPlayerList[1],
        });
        expect(emits[2]).toBeCalledWith("update", {
            ...jsonLobby,
            me: jsonPlayerList[2],
        });
    });

    it("removePlayer works", () => {
        const disconnect = jest.fn();
        const mockPlayer = generateMockPlayer({
            socket: ({ disconnect } as unknown) as SocketIO.Socket,
        });

        const playerList = [mockPlayer];
        const mockLobby: Lobby = generateMockLobby({
            playerList,
        });

        removePlayer(mockPlayer, mockLobby);

        expect(playerList.length).toBe(0);
        expect(playerList).not.toContain(mockPlayer);
        expect(disconnect).toHaveBeenCalledWith(true);
    });

    it("removePlayer sets new host", () => {
        const mockLobby: Lobby = generateMockLobby({
            playerList: generateMockPlayerList(2, (player) => ({
                ...player,
                socket: {
                    disconnect: jest.fn(),
                } as Partial<SocketIO.Socket>,
            })),
        });

        const playerToRemove = mockLobby.playerList[0];
        removePlayer(playerToRemove, mockLobby);

        expect(mockLobby.playerList.length).toBe(1);
        expect(mockLobby.playerList).not.toContain(playerToRemove);
        expect(mockLobby.playerList[0].isHost).toBe(true);
        expect(mockLobby.idealHostId).toBe(0);
    });

    it("deleteLobbyIfEmpty deletes empty lobby", () => {
        const mockLobby: Lobby = generateMockLobby();
        const lobbyList: Array<Lobby> = [mockLobby];

        deleteLobbyIfEmpty(mockLobby, lobbyList);

        expect(lobbyList.length).toBe(0);
    });

    it("deleteLobbyIfEmpty doesn't delete non-empty lobby", () => {
        const mockLobby: Lobby = generateMockLobby({
            playerList: generateMockPlayerList(1),
        });
        const lobbyList: Array<Lobby> = [mockLobby];

        deleteLobbyIfEmpty(mockLobby, lobbyList);

        expect(lobbyList).toContain(mockLobby);
    });

    it("setGame works", () => {
        const mockLobby: Lobby = generateMockLobby({
            playerList: generateMockPlayerList(1),
        });

        setGame("CoolGame", mockLobby);

        expect(mockLobby.selectedGame).toBe("CoolGame");
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
        const mockLobby = generateMockLobby({
            status: LobbyStatus.lobby,
            selectedGame: "FooGame",
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

        await startGame(mockLobby);

        expect(mockLobby.status).toBe(LobbyStatus.ingame);
        expect(mockLobby.gameState.status).toBe(GameStatus.waitingforhost);

        // TODO: test call to getJoinGameUrl
    });

    it("startGame fails if game doesn't exist", () => {
        const mockLobby = generateMockLobby({
            status: LobbyStatus.lobby,
            selectedGame: "GameThatDoesntExist",
            gameState: {
                status: undefined,
            },
        });

        startGame(mockLobby);

        expect(mockLobby.status).toBe(LobbyStatus.lobby);
        expect(mockLobby.gameState.status).toBeUndefined();
    });

    it("exitGame works", () => {
        const mockLobby = generateMockLobby({
            status: LobbyStatus.ingame,
            selectedGame: "FooGame",
            gameState: {
                status: GameStatus.inprogress,
                joinGameURL: {
                    playerURL: "test.com",
                    hostURL: "host.com",
                },
            },
        });

        exitGame(mockLobby);

        expect(mockLobby.status).toBe(LobbyStatus.lobby);
        expect(mockLobby.gameState.status).toBe(GameStatus.loading);
        expect(mockLobby.gameState.joinGameURL.playerURL).toBe("");
        expect(mockLobby.gameState.joinGameURL.hostURL).toBe("");
    });
});

const generateMockLobby = ({
    status = LobbyStatus.lobby,
    playerList = [],
    code = "efgh",
    selectedGame = "FooGame",
    gameState = {} as GameState,
    nextPlayerId = 1,
    idealHostId = 0,
}: Partial<Lobby> = {}): Lobby => ({
    status,
    playerList,
    code,
    selectedGame,
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
