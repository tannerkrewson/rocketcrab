import {
    initRocketCrab,
    newLobby,
    getLobby,
    addPlayer,
    sendStateToAll,
    removePlayer,
    deleteLobbyIfEmpty,
    setGame,
} from "../../server/rocketcrab";
import { Lobby, Player } from "../../types/types";
import { LobbyStatus } from "../../types/enums";

const MOCK_GAME_LIST = [{ name: "FooGame" }, { name: "CoolGame" }];

jest.mock("../../games", () =>
    jest.fn(() => [{ name: "FooGame" }, { name: "CoolGame" }])
);

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
        const mockPlayer = { name: "foo", socket: {} as SocketIO.Socket };
        const playerList: Array<Player> = [];
        addPlayer(mockPlayer, playerList);

        expect(playerList.length).toBe(1);
        expect(playerList).toContain(mockPlayer);
    });

    it("sendStateToAll works", () => {
        const emit = jest.fn();
        const mockLobby: Lobby = {
            status: LobbyStatus.lobby,
            playerList: [
                {
                    name: "foo",
                    socket: ({ emit } as unknown) as SocketIO.Socket,
                },
            ],
            code: "efgh",
            selectedGame: "FooGame",
            gameList: MOCK_GAME_LIST,
        };

        const jsonLobby = {
            status: LobbyStatus.lobby,
            playerList: [
                {
                    name: "foo",
                },
            ],
            code: "efgh",
            me: {
                name: "foo",
            },
            selectedGame: "FooGame",
            gameList: MOCK_GAME_LIST,
        };

        sendStateToAll(mockLobby);

        expect(emit).toBeCalledWith("update", jsonLobby);
    });

    it("removePlayer works", () => {
        const disconnect = jest.fn();
        const mockPlayer = {
            name: "foo",
            socket: ({ disconnect } as unknown) as SocketIO.Socket,
        };
        const playerList: Array<Player> = [mockPlayer];

        removePlayer(mockPlayer, playerList);

        expect(playerList.length).toBe(0);
        expect(playerList).not.toContain(mockPlayer);
        expect(disconnect).toHaveBeenCalledWith(true);
    });

    it("deleteLobbyIfEmpty deletes empty lobby", () => {
        const mockLobby: Lobby = {
            status: LobbyStatus.lobby,
            playerList: [],
            code: "efgh",
            selectedGame: "FooGame",
            gameList: MOCK_GAME_LIST,
        };
        const lobbyList: Array<Lobby> = [mockLobby];

        deleteLobbyIfEmpty(mockLobby, lobbyList);

        expect(lobbyList.length).toBe(0);
    });

    it("deleteLobbyIfEmpty doesn't delete non-empty lobby", () => {
        const mockLobby: Lobby = {
            status: LobbyStatus.lobby,
            playerList: [
                {
                    name: "foo",
                    socket: {} as SocketIO.Socket,
                },
            ],
            code: "efgh",
            selectedGame: "FooGame",
            gameList: MOCK_GAME_LIST,
        };
        const lobbyList: Array<Lobby> = [mockLobby];

        deleteLobbyIfEmpty(mockLobby, lobbyList);

        expect(lobbyList).toContain(mockLobby);
    });

    it("setGame works", () => {
        const mockLobby: Lobby = {
            status: LobbyStatus.lobby,
            playerList: [
                {
                    name: "foo",
                    socket: {} as SocketIO.Socket,
                },
            ],
            code: "efgh",
            selectedGame: "",
            gameList: MOCK_GAME_LIST,
        };
        setGame("CoolGame", mockLobby);

        expect(mockLobby.selectedGame).toBe("CoolGame");
    });
});
