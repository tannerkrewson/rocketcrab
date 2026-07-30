import type { Server } from "socket.io";
import { newParty } from "../../server/rocketcrab";
import api from "../../server/socket";
import { RocketcrabMode, SocketEvent } from "../../types/enums";
import { RocketCrab } from "../../types/types";

describe("server/socket.ts", () => {
    let socket;
    let io;
    let rocketcrab: RocketCrab;
    beforeEach(() => {
        socket = {
            on: jest.fn(),
            emit: jest.fn(),
            join: jest.fn(),
            handshake: { headers: {} },
        };
        io = {
            on: (event, handler) => {
                handler(socket);
            },
        } as unknown as Server;

        rocketcrab = {
            partyList: [],
        } as Partial<RocketCrab> as RocketCrab;

        api(io, rocketcrab);
    });
    it("join handler called", () => {
        const actualCall = socket.on.mock.calls[0];
        expect(actualCall[0]).toEqual(SocketEvent.JOIN_PARTY);
    });

    it("can't join if party doesn't exist", () => {
        const handler = socket.on.mock.calls[0][1];

        handler({
            code: "xxxx",
            lastPartyState: undefined,
            reconnecting: false,
        });

        const actualEmittedEvent = socket.emit.mock.calls[0][0];

        expect(actualEmittedEvent).toBe(SocketEvent.INVALID_PARTY);
    });

    it("can join if modes match", () => {
        socket.handshake.headers.host = "kids.rocketcrab.com";

        newParty({
            rocketcrab,
            mode: RocketcrabMode.KIDS,
            forceGameCode: "abcd",
        });

        const handler = socket.on.mock.calls[0][1];

        handler({
            code: "abcd",
            lastPartyState: undefined,
            reconnecting: false,
        });

        const actualEmittedEvent = socket.emit.mock.calls[0][0];

        expect(actualEmittedEvent).toBe(SocketEvent.UPDATE);
    });

    it("can't join if modes don't match", () => {
        socket.handshake.headers.host = "rocketcrab.com";

        newParty({
            rocketcrab,
            mode: RocketcrabMode.KIDS,
            forceGameCode: "abcd",
        });

        const handler = socket.on.mock.calls[0][1];

        handler({
            code: "abcd",
            lastPartyState: undefined,
            reconnecting: false,
        });

        const actualEmittedEvent = socket.emit.mock.calls[0][0];

        expect(actualEmittedEvent).toBe(SocketEvent.INVALID_PARTY);
    });

    it("reconnectToParty is called for reconnecting players with missing party", () => {
        const handler = socket.on.mock.calls[0][1];

        handler({
            code: "xxxx",
            lastPartyState: {
                uuid: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
                code: "xxxx",
                me: { id: 0, name: "foo", isHost: true },
            },
            reconnecting: true,
        });

        const emittedEvents = socket.emit.mock.calls.map((c) => c[0]);
        expect(emittedEvents).toContain(SocketEvent.UPDATE);
    });

    it("banned player is rejected even if party exists", () => {
        socket.handshake.address = "10.0.0.1";

        newParty({
            rocketcrab,
            mode: RocketcrabMode.MAIN,
            forceGameCode: "banned",
        });

        const bannedParty = rocketcrab.partyList[0];
        bannedParty.bannedIPs.push("10.0.0.1");

        const handler = socket.on.mock.calls[0][1];
        handler({
            code: "banned",
            lastPartyState: undefined,
            reconnecting: false,
        });

        expect(socket.emit).toBeCalledWith(SocketEvent.INVALID_PARTY, {
            code: "banned",
        });
    });

    it("party join triggers room join", () => {
        newParty({
            rocketcrab,
            mode: RocketcrabMode.MAIN,
            forceGameCode: "room1",
        });

        const handler = socket.on.mock.calls[0][1];
        handler({
            code: "room1",
            lastPartyState: undefined,
            reconnecting: false,
        });

        expect(socket.join).toBeCalledWith("room1");
    });
});
