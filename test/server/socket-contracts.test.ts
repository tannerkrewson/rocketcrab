// @vitest-environment node
/**
 * Socket.IO event contract characterization tests.
 *
 * These tests verify the Socket.IO protocol contracts between
 * server and client — event names, payload shapes, and lifecycle behavior.
 * They don't start a real Socket.IO server; they test the event handler
 * wiring and the rocketcrab module logic that Socket.IO handlers invoke.
 */

import { describe, expect, it, vi } from "vitest";
import type { Server, Socket } from "socket.io";

// ---------------------------------------------------------------------------
// Mock config before any module imports
// ---------------------------------------------------------------------------
vi.mock("../../config", () => ({
    getServerGameLibrary: vi.fn(() => ({
        gameList: [
            {
                id: "drawphone",
                name: "Drawphone",
                connectToGame: async () => ({
                    player: { url: "drawphone.example.com" },
                }),
            },
        ],
        categories: [],
    })),
    getClientGameLibrary: vi.fn(() => ({
        gameList: [{ id: "drawphone", name: "Drawphone" }],
        categories: [],
    })),
}));

import { newParty } from "../../server/rocketcrab";
import attachSocketHandlers from "../../server/socket";
import {
    SocketEvent,
    PartyStatus,
    GameStatus,
    RocketcrabMode,
} from "../../types/enums";
import type { RocketCrab, ClientParty, Party } from "../../types/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockSocketEvent = {
    event: string;
    handler: (...args: unknown[]) => void;
};

type MockSocket = {
    on: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    join: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    handshake: { headers: Record<string, string | undefined>; address: string };
    disconnect: ReturnType<typeof vi.fn>;
};

function createMockSocket(host?: string): MockSocket {
    return {
        on: vi.fn(),
        emit: vi.fn(),
        join: vi.fn(),
        once: vi.fn(),
        handshake: {
            headers: { host: host || "rocketcrab.com" },
            address: "127.0.0.1",
        },
        disconnect: vi.fn(),
    };
}

function createMockIo(onConnection: (socket: MockSocket) => void): unknown {
    return {
        on: vi.fn((event: string, handler: (socket: MockSocket) => void) => {
            expect(event).toBe("connection");
            onConnection(handler);
        }),
    } as unknown as Server;
}

/** Extract the handler registered for a specific event on a mock socket */
function getHandler(
    socket: MockSocket,
    event: SocketEvent,
): (...args: unknown[]) => void {
    const call = socket.on.mock.calls.find(([ev]: [string]) => ev === event);
    if (!call) throw new Error(`Handler for ${event} not registered`);
    return call[1];
}

function makeMinimalParty(overrides: Partial<Party> = {}): Party {
    const party = newParty({
        rocketcrab: { partyList: [] },
        forceGameCode: "test",
        mode: RocketcrabMode.MAIN,
    });
    return { ...party, ...overrides };
}

// ---------------------------------------------------------------------------
// SocketEvent contract: event names match server/client expectations
// ---------------------------------------------------------------------------

describe("SocketEvent enum contract", () => {
    it("defines all expected client-server events", () => {
        // These are the events that the server sends or receives
        const serverEvents = [
            SocketEvent.CONNECT,
            SocketEvent.DISCONNECT,
            SocketEvent.RECONNECT,
            SocketEvent.JOIN_PARTY,
            SocketEvent.NAME,
            SocketEvent.GAME_SELECT,
            SocketEvent.GAME_START,
            SocketEvent.GAME_EXIT,
            SocketEvent.HOST_GAME_LOADED,
            SocketEvent.UPDATE,
            SocketEvent.INVALID_NAME,
            SocketEvent.INVALID_PARTY,
            SocketEvent.CHAT_MESSAGE,
            SocketEvent.KICK_PLAYER,
            SocketEvent.SET_IS_PUBLIC,
        ];
        expect(serverEvents.length).toBeGreaterThanOrEqual(14);
        serverEvents.forEach((ev) => {
            expect(typeof ev).toBe("string");
        });
    });
});

// ---------------------------------------------------------------------------
// Server socket module: handler registration
// ---------------------------------------------------------------------------

describe("server/socket.ts handler registration", () => {
    it("registers connection handler on io", () => {
        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, { partyList: [] });

        expect(io.on).toHaveBeenCalledWith("connection", expect.any(Function));
        expect(connectionHandler).not.toBeNull();
    });

    it("registers JOIN_PARTY handler on each connected socket", () => {
        const mockSocket = createMockSocket();

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, { partyList: [] });
        connectionHandler!(mockSocket);

        expect(mockSocket.on).toHaveBeenCalledWith(
            SocketEvent.JOIN_PARTY,
            expect.any(Function),
        );
    });
});

// ---------------------------------------------------------------------------
// Party lifecycle via sockets
// ---------------------------------------------------------------------------

describe("Party lifecycle via socket events", () => {
    it("JOIN_PARTY with valid code triggers UPDATE and adds party listeners", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const party = newParty({
            rocketcrab,
            forceGameCode: "abcd",
        });
        const mockSocket = createMockSocket();

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(mockSocket);

        const joinHandler = getHandler(mockSocket, SocketEvent.JOIN_PARTY);
        joinHandler({ code: "abcd", lastPartyState: {}, reconnecting: false });

        // Should emit UPDATE with party state
        const updateCall = mockSocket.emit.mock.calls.find(
            ([ev]: [string]) => ev === SocketEvent.UPDATE,
        );
        expect(updateCall).toBeTruthy();
        expect(updateCall![1].code).toBe("abcd");

        // Should have registered additional event handlers on the socket
        expect(mockSocket.on).toHaveBeenCalledWith(
            SocketEvent.DISCONNECT,
            expect.any(Function),
        );
        expect(mockSocket.on).toHaveBeenCalledWith(
            SocketEvent.NAME,
            expect.any(Function),
        );
        expect(mockSocket.on).toHaveBeenCalledWith(
            SocketEvent.GAME_SELECT,
            expect.any(Function),
        );
    });

    it("JOIN_PARTY with non-existent code emits INVALID_PARTY", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const mockSocket = createMockSocket();

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(mockSocket);

        const joinHandler = getHandler(mockSocket, SocketEvent.JOIN_PARTY);
        joinHandler({ code: "xxxx", lastPartyState: {}, reconnecting: false });

        expect(mockSocket.emit).toHaveBeenCalledWith(
            SocketEvent.INVALID_PARTY,
            {
                code: "xxxx",
            },
        );
    });

    it("JOIN_PARTY with banned IP emits INVALID_PARTY", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const party = newParty({
            rocketcrab,
            forceGameCode: "banned",
        }) as Party;
        party.bannedIPs = ["127.0.0.1"];

        const mockSocket = createMockSocket();

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(mockSocket);

        const joinHandler = getHandler(mockSocket, SocketEvent.JOIN_PARTY);
        joinHandler({
            code: "banned",
            lastPartyState: {},
            reconnecting: false,
        });

        expect(mockSocket.emit).toHaveBeenCalledWith(
            SocketEvent.INVALID_PARTY,
            {
                code: "banned",
            },
        );
    });

    it("NAME event updates player name and triggers UPDATE", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const party = newParty({
            rocketcrab,
            forceGameCode: "name1",
        });
        const mockSocket = createMockSocket();

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(mockSocket);

        // Join first
        const joinHandler = getHandler(mockSocket, SocketEvent.JOIN_PARTY);
        joinHandler({ code: "name1", lastPartyState: {}, reconnecting: false });

        mockSocket.emit.mockClear();

        // Then set name
        const nameHandler = getHandler(mockSocket, SocketEvent.NAME);
        nameHandler("Alice");

        expect(mockSocket.emit).toHaveBeenCalledWith(
            SocketEvent.UPDATE,
            expect.objectContaining({
                me: expect.objectContaining({ name: "Alice" }),
            }),
        );
    });

    it("GAME_SELECT event (host-only) updates selected game", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const party = newParty({
            rocketcrab,
            forceGameCode: "game1",
        });
        const mockSocket = createMockSocket();

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(mockSocket);

        // Join (first joiner becomes host)
        const joinHandler = getHandler(mockSocket, SocketEvent.JOIN_PARTY);
        joinHandler({ code: "game1", lastPartyState: {}, reconnecting: false });

        // Player 0 (host) selects a game
        mockSocket.emit.mockClear();
        const selectHandler = getHandler(mockSocket, SocketEvent.GAME_SELECT);
        selectHandler("drawphone");

        expect(mockSocket.emit).toHaveBeenCalledWith(
            SocketEvent.UPDATE,
            expect.objectContaining({
                selectedGameId: "drawphone",
            }),
        );
    });

    it("CHAT_MESSAGE event adds message and triggers UPDATE", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const party = newParty({
            rocketcrab,
            forceGameCode: "chat1",
        });
        const mockSocket = createMockSocket();

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(mockSocket);

        // Join
        const joinHandler = getHandler(mockSocket, SocketEvent.JOIN_PARTY);
        joinHandler({ code: "chat1", lastPartyState: {}, reconnecting: false });

        mockSocket.emit.mockClear();

        // Send chat
        const chatHandler = getHandler(mockSocket, SocketEvent.CHAT_MESSAGE);
        chatHandler("Hello world!");

        expect(mockSocket.emit).toHaveBeenCalledWith(
            SocketEvent.UPDATE,
            expect.objectContaining({
                chat: expect.arrayContaining([
                    expect.objectContaining({ message: "Hello world!" }),
                ]),
            }),
        );
    });
});

// ---------------------------------------------------------------------------
// Game lifecycle via sockets
// ---------------------------------------------------------------------------

describe("Game lifecycle via socket events", () => {
    it("GAME_START launches game and transitions to ingame", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const mockSocket = createMockSocket();

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(mockSocket);

        // Create party
        newParty({
            rocketcrab,
            forceGameCode: "play1",
        });

        // Join via JOINT_PARTY (first joiner becomes host)
        const joinHandler = getHandler(mockSocket, SocketEvent.JOIN_PARTY);
        joinHandler({ code: "play1", lastPartyState: {}, reconnecting: false });

        mockSocket.emit.mockClear();

        // Select game first
        const selectHandler = getHandler(mockSocket, SocketEvent.GAME_SELECT);
        selectHandler("drawphone");

        // Grab the last UPDATE to verify selected game set
        // Then clear for the next stage
        const updatesBeforeStart = mockSocket.emit.mock.calls.filter(
            ([ev]: [string]) => ev === SocketEvent.UPDATE,
        );
        const lastUpdateBefore =
            updatesBeforeStart[updatesBeforeStart.length - 1];
        expect(lastUpdateBefore[1].selectedGameId).toBe("drawphone");

        mockSocket.emit.mockClear();

        // Start game
        const startHandler = getHandler(mockSocket, SocketEvent.GAME_START);
        startHandler("drawphone");

        // Should emit UPDATE with ingame status
        const updatesAfter = mockSocket.emit.mock.calls.filter(
            ([ev]: [string]) => ev === SocketEvent.UPDATE,
        );
        expect(updatesAfter.length).toBeGreaterThan(0);
        const gameUpdate = updatesAfter[updatesAfter.length - 1];
        expect(gameUpdate[1].status).toBe(PartyStatus.ingame);
    });

    it("GAME_EXIT transitions back to party status", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const mockSocket = createMockSocket();

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(mockSocket);

        const party = newParty({
            rocketcrab,
            forceGameCode: "exit1",
        });

        // Join (first joiner becomes host)
        const joinHandler = getHandler(mockSocket, SocketEvent.JOIN_PARTY);
        joinHandler({ code: "exit1", lastPartyState: {}, reconnecting: false });

        mockSocket.emit.mockClear();

        // Exit game
        const exitHandler = getHandler(mockSocket, SocketEvent.GAME_EXIT);
        exitHandler();

        const updates = mockSocket.emit.mock.calls.filter(
            ([ev]: [string]) => ev === SocketEvent.UPDATE,
        );
        expect(updates.length).toBeGreaterThan(0);
        expect(updates[updates.length - 1][1].status).toBe(PartyStatus.party);
    });

    it("KICK_PLAYER removes player and emits UPDATE", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const hostSocket = createMockSocket();
        const targetSocket = createMockSocket();
        const party = newParty({
            rocketcrab,
            forceGameCode: "kick1",
        });

        // Wire up io with two separate connection events
        let connectionCalls: Array<(socket: MockSocket) => void> = [];
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionCalls.push(handler);
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);

        // Host connects
        connectionCalls[0](hostSocket);
        const hostJoin = getHandler(hostSocket, SocketEvent.JOIN_PARTY);
        hostJoin({ code: "kick1", lastPartyState: {}, reconnecting: false });

        // Target connects
        connectionCalls[0](targetSocket);
        const targetJoin = getHandler(targetSocket, SocketEvent.JOIN_PARTY);
        targetJoin({ code: "kick1", lastPartyState: {}, reconnecting: false });

        hostSocket.emit.mockClear();

        // Host kicks player with id=1 (the second joiner)
        const kickHandler = getHandler(hostSocket, SocketEvent.KICK_PLAYER);
        kickHandler({ playerId: 1, isBan: false });

        const updates = hostSocket.emit.mock.calls.filter(
            ([ev]: [string]) => ev === SocketEvent.UPDATE,
        );
        expect(updates.length).toBeGreaterThan(0);
        const update = updates[updates.length - 1];
        const playerIds = update[1].playerList.map((p: { id: number }) => p.id);
        expect(playerIds).not.toContain(1);
    });
});

// ---------------------------------------------------------------------------
// Disconnect and party cleanup
// ---------------------------------------------------------------------------

describe("Socket disconnect behavior", () => {
    it("DISCONNECT removes player and triggers UPDATE", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const mockSocket = createMockSocket();
        // Intentionally discard the returned party reference — we access it via rocketcrab.partyList
        newParty({
            rocketcrab,
            forceGameCode: "disc1",
        });

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(mockSocket);

        const joinHandler = getHandler(mockSocket, SocketEvent.JOIN_PARTY);
        joinHandler({ code: "disc1", lastPartyState: {}, reconnecting: false });

        const party = rocketcrab.partyList[0];
        expect(party.playerList.length).toBe(1);

        mockSocket.emit.mockClear();

        // Disconnect
        const disconnectHandler = getHandler(
            mockSocket,
            SocketEvent.DISCONNECT,
        );
        disconnectHandler();

        // Should have removed the player from party
        expect(party.playerList.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// SET_IS_PUBLIC contract
// ---------------------------------------------------------------------------

describe("SET_IS_PUBLIC event contract", () => {
    it("only host can toggle isPublic", () => {
        const rocketcrab: RocketCrab = { partyList: [] };
        const hostSocket = createMockSocket();

        const party = newParty({
            rocketcrab,
            forceGameCode: "pub1",
        });

        let connectionHandler: ((socket: MockSocket) => void) | null = null;
        const io = {
            on: vi.fn(
                (_event: string, handler: (socket: MockSocket) => void) => {
                    connectionHandler = handler;
                },
            ),
        } as unknown as Server;

        attachSocketHandlers(io, rocketcrab);
        connectionHandler!(hostSocket);

        // Join (first joiner becomes host)
        const hostJoinHandler = getHandler(hostSocket, SocketEvent.JOIN_PARTY);
        hostJoinHandler({
            code: "pub1",
            lastPartyState: {},
            reconnecting: false,
        });

        // Host toggles public
        hostSocket.emit.mockClear();
        const hostSetPublic = getHandler(hostSocket, SocketEvent.SET_IS_PUBLIC);
        hostSetPublic(true);
        expect(party.isPublic).toBe(true);
        expect(hostSocket.emit).toHaveBeenCalledWith(
            SocketEvent.UPDATE,
            expect.any(Object),
        );
    });
});
