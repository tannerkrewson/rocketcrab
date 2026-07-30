import { PartyStatus, GameStatus, RocketcrabMode } from "./enums";
import WebSocket from "ws";
import { Dispatch, SetStateAction } from "react";
import type { Socket } from "socket.io";

export const MAX_CHAT_MSG_LEN = 100;
export const MAX_CHATS_OVERALL = 20;
export const MIN_MS_BETWEEN_MSGS = 1 * 1000; // 1 second
export const ENABLE_FILTER = true;

export type RocketCrab = {
    partyList: Array<Party>;
};

export type Party = CommonParty & {
    nextPlayerId: number;
};

export type ClientParty = CommonParty & {
    me?: Player;
};

type CommonParty = {
    status: PartyStatus;
    playerList: Array<Player>;
    code: string;
    uuid: string;
    selectedGameId: string;
    gameState: GameState;
    idealHostId: number;
    isPublic: boolean;
    createdAsPublic: boolean;
    publicEndDate?: number;
    chat: Array<ChatMessage>;
    bannedIPs: Array<string>;
    mode: RocketcrabMode;
};

export type Player = {
    id: number;
    name: string;
    socket?: Socket;
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
    showOn: Array<RocketcrabMode>;
    minPlayers?: number;
    maxPlayers?: number;
    renameParams?: Record<string, string>;
};

export type BasedOn = {
    game: string;
    author?: string;
    link?: string;
    bggId?: number;
};

export type ServerGame = ClientGame & {
    connectToGame: () => Promise<ConnectedGame>;
};

export type ConnectedGame = {
    player: ConnectedGameURL;
    host?: Partial<ConnectedGameURL>; // this just makes the url optional for host
};

export type ConnectedGameURL = {
    url: string;
    customQueryParams?: Record<string, string>;
    afterQueryParams?: string;
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
    connectedGame?: ConnectedGame;
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
    hide?: boolean;
};

export type LibraryState = {
    selectedCategory: string;
    setSelectedCategory: Dispatch<SetStateAction<string>>;
    search: string;
    setSearch: Dispatch<SetStateAction<string>>;
};

export type ChatMessage = {
    playerId: number;
    playerName: string;
    message: string;
    date: number;
};
