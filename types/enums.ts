export enum PartyStatus {
    loading = "loading",
    party = "party",
    ingame = "ingame",
}

export enum GameStatus {
    loading = "loading",
    inprogress = "inprogress",
    waitingforhost = "waitingforhost",
    error = "error",
}

export enum SocketEvent {
    DISCONNECT = "DISCONNECT",
    GAME_EXIT = "GAME_EXIT",
    GAME_SELECT = "GAME_SELECT",
    GAME_START = "GAME_START",
    HOST_GAME_LOADED = "HOST_GAME_LOADED",
    INVALID_NAME = "INVALID_NAME",
    INVALID_PARTY = "INVALID_PARTY",
    JOIN_PARTY = "JOIN_PARTY",
    NAME = "NAME",
    RECONNECT = "reconnect",
    UPDATE = "UPDATE",
    FINDER_SUBSCRIBE = "FINDER_SUBSCRIBE",
    FINDER_UPDATE = "FINDER_UPDATE",
}
