import { LobbyStatus, GameStatus } from "./enums";

export type RocketCrab = {
    lobbyList: Array<Lobby>;
};

export type Lobby = {
    status: LobbyStatus;
    playerList: Array<Player>;
    code: string;
    uuid?: string;
    selectedGame: string;
    gameState: GameState;
    nextPlayerId: number;
    idealHostId: number;
};

export type Player = {
    id: number;
    name: string;
    socket?: SocketIO.Socket;
    isHost: boolean;
};

export type ClientGame = {
    id: string;
    name: string;
    author?: string;
    basedOn?: BasedOn;
    description?: string;
    displayUrlText: string;
    displayUrlHref: string;
    donationUrlText?: string;
    donationUrlHref?: string;
    category?: Array<string>;
    players?: string;
    familyFriendly: boolean;
    minPlayers?: number;
    maxPlayers?: number;
    renameParams?: Record<string, string>;
};

export type BasedOn = {
    game: string;
    author?: string;
    link?: string;
};

export type ServerGame = ClientGame & {
    getJoinGameUrl: () => Promise<JoinGameURL>;
};

export type JoinGameURL = {
    playerURL: string;
    hostURL?: string;
    code?: string;
};

export type GameCategory = {
    id: string;
    name: string;
    color: string;
    backgroundColor: string;
};

export type ClientGameLibrary = {
    categories: Array<GameCategory>;
    gameList: Array<ClientGame>;
};

export type ServerGameLibrary = {
    categories: Array<GameCategory>;
    gameList: Array<ServerGame>;
};

export type GameState = {
    status: GameStatus;
    error?: string;
    joinGameURL?: JoinGameURL;
};

export type JoinLobbyResponse = {
    code: string;
    id?: number;
    name?: string;
};
