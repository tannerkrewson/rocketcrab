import { LobbyStatus } from "./enums";

export type RocketCrab = {
    lobbyList: Array<Lobby>;
};

export type Lobby = {
    status: LobbyStatus;
    playerList: Array<Player>;
    code: string;
    selectedGame: string;
    gameList: Array<Game>;
};

export type Player = {
    name: string;
    socket: SocketIO.Socket;
};

export type Game = any;

export type JoinLobbyResponse = {
    code: string;
    name?: string;
};

export type PageLayoutParams = {
    children: JSX.Element[] | JSX.Element;
    path?: string;
};
