import {
    initRocketCrab,
    newLobby,
    getLobby,
    addPlayer,
    sendUpdatedLobby,
} from "../../server/rocketcrab";
import { Lobby, Player } from "../../types/types";
import { LobbyStatus } from "../../types/enums";

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
        const newPlayer = { name: "foo", socket: {} as SocketIO.Socket };
        const playerList: Array<Player> = [];
        addPlayer(newPlayer, playerList);

        expect(playerList.length).toBe(1);
        expect(playerList).toContain(newPlayer);
    });

    it("sendUpdatedLobby works", () => {
        const mockLobby: Lobby = {
            status: LobbyStatus.lobby,
            playerList: [],
            code: "efgh",
        };

        const emit = jest.fn();
        const to = jest.fn(() => ({ emit }));
        const mockIO: SocketIO.Server = ({
            to,
        } as unknown) as SocketIO.Server;

        sendUpdatedLobby(mockLobby, mockIO);

        expect(to).toBeCalledWith(mockLobby.code);
        expect(emit).toBeCalledWith("update", mockLobby);
    });
});
