import { PartyStatus, GameStatus } from "./enums";
import WebSocket from "ws";
import { Dispatch, SetStateAction } from "react";
import { BindingsChangeTarget } from "@geist-ui/react/dist/input/use-input";

export const FINDER_ACTIVE_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_CHAT_MSG_LEN = 100;
export const MAX_CHATS_FROM_SINGLE_PLAYER = 3;
export const MAX_CHATS_OVERALL = 20;
export const MIN_MS_BETWEEN_MSGS = 5 * 1000; // 5 seconds
export const ENABLE_FILTER = true;

export type RocketCrab = {
    partyList: Array<Party>;
    isFinderActive: boolean;
    finderSubscribers: Array<SocketIO.Socket>;
    finderActiveDates?: FinderActiveDates;
};

export type FinderState = {
    isActive: boolean;
    publicPartyList: Array<ClientParty>;
    finderActiveDates: FinderActiveDates;
    subscriberCount: number;
};

export type FinderActiveDates = {
    lastStart: number;
    nextStart: number;
    nextWeekOfStarts: number[];
};

export type Party = ClientParty & {
    nextPlayerId: number;
};

export type ClientParty = {
    status: PartyStatus;
    playerList: Array<Player>;
    code: string;
    uuid: string;
    me?: Player;
    selectedGameId: string;
    gameState: GameState;
    idealHostId: number;
    isPublic: boolean;
    publicEndDate?: number;
    chat: Array<ChatMessage>;
    bannedIPs: Array<string>;
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
    guideId?: string;
    guide?: string;
    guideUrl?: string;
    pictures?: Array<string>;
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

export type JoinPartyResponse = {
    code: string;
    lastPartyState: ClientParty;
    reconnecting: boolean;
};

export type PromiseWebSocket = WebSocket & {
    onOpen: () => Promise<void>;
    onMessage: () => Promise<string>;
    untilMessage: (msgChecker: (msg: string) => boolean) => Promise<string>;
};

export type MenuButton = {
    label: string;
    hostOnly: boolean;
    onClick: () => void;
    badgeCount?: number;
};

export type LibraryState = {
    selectedCategory: string;
    setSelectedCategory: Dispatch<SetStateAction<string>>;
    search: string;
    setSearch: Dispatch<SetStateAction<string>>;
    searchBindings: SearchBindingsType;
};

export type ChatMessage = {
    playerId: number;
    playerName: string;
    message: string;
    date: number;
};

type SearchBindingsType = {
    value: string;
    onChange: (event: BindingsChangeTarget) => void;
};
