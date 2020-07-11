import { RocketCrab, Lobby, Player } from "../types/types";
import { LobbyStatus } from "../types/enums";

export const initRocketCrab = (): RocketCrab => ({
    lobbyList: [],
});

export const newLobby = ({ lobbyList }: RocketCrab) => {
    const code: string = getUniqueGameCode(lobbyList);
    lobbyList.push({ status: LobbyStatus.lobby, playerList: [], code });
    return code;
};

export const getLobby = (newCode: string, { lobbyList }: RocketCrab) =>
    lobbyList.find(({ code }) => code === newCode);

export const addPlayer = (player: Player, { playerList }: Lobby) =>
    playerList.push(player);

export const sendUpdatedLobby = (lobby: Lobby, io: SocketIO.Server) =>
    io.to(lobby.code).emit("update", getJsonLobby(lobby));

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
