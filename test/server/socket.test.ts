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
        io = ({
            on: (event, handler) => {
                handler(socket);
            },
        } as unknown) as Server;

        rocketcrab = ({
            partyList: [],
        } as Partial<RocketCrab>) as RocketCrab;

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
});
