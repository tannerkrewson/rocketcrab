import { LobbyStatus } from "./enums";

export type RocketCrab = {
    lobbyList: Array<Lobby>;
};

export type Lobby = {
    status: LobbyStatus;
    playerList: Array<Player>;
    code: string;
};

export type Player = {
    name: string;
    socket: SocketIO.Socket;
};

export type Game = {
    newUrl: string;
};

export type JoinLobbyResponse = {
    code: string;
    name?: string;
};
