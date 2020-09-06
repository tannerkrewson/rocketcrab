import api from "../../server/api";
import { Application } from "express";
import { RocketCrab } from "../../types/types";

describe("server/api.ts", () => {
    let app;
    let rocketcrab: RocketCrab;
    beforeEach(() => {
        app = ({
            post: jest.fn(),
            get: jest.fn(),
        } as unknown) as Application;

        rocketcrab = {
            lobbyList: [],
        };

        api(app, rocketcrab);
    });

    it("/api/new works", () => {
        expect(app.post.mock.calls[0][0]).toEqual("/api/new");
        const handler = app.post.mock.calls[0][1];
        const res = { json: jest.fn() };
        handler(undefined, res);

        expect(rocketcrab.lobbyList[0].code).toEqual(
            res.json.mock.calls[0][0].code
        );
    });

    it("/api/transfer create lobby", () => {
        expect(app.get.mock.calls[0][0]).toEqual("/api/transfer");
        const handler = app.get.mock.calls[0][1];
        const req = {
            query: {
                uuid: "12345",
                gameid: "tk-drawphone",
                name: "John",
            },
        };
        const res = {
            cookie: jest.fn(),
            redirect: jest.fn(),
        };
        handler(req, res);

        expect(rocketcrab.lobbyList[0].uuid).toEqual(req.query.uuid);
        expect(rocketcrab.lobbyList[0].selectedGame).toEqual(req.query.gameid);
        expect(res.cookie.mock.calls[0][1]).toEqual(req.query.name);
    });

    it("/api/transfer doesn't create lobby if already made", () => {
        const handler = app.get.mock.calls[0][1];
        const res = {
            cookie: jest.fn(),
            redirect: jest.fn(),
        };
        handler(
            {
                query: {
                    uuid: "12345",
                    gameid: "tk-drawphone",
                    name: "John",
                },
            },
            res
        );
        handler(
            {
                query: {
                    uuid: "12345",
                    gameid: "tk-srawphone",
                    name: "Bob",
                },
            },
            res
        );

        expect(rocketcrab.lobbyList.length).toEqual(1);
    });

    it("/api/transfer doesn't create lobby if uuid invalid", () => {
        const handler = app.get.mock.calls[0][1];
        const req = {
            query: {
                uuid: "123",
            },
        };
        const end = jest.fn();
        const res = {
            status: jest.fn(() => ({ end })),
        };
        handler(req, res);

        expect(rocketcrab.lobbyList.length).toEqual(0);
        expect(res.status).toBeCalledWith(400);
        expect(end).toBeCalled();
    });

    it("/game/:gameid works", () => {
        expect(app.get.mock.calls[1][0]).toEqual("/game/:gameid");
        const handler = app.get.mock.calls[1][1];
        const req = {
            params: {
                gameid: "tk-drawphone",
            },
        };
        const res = {
            redirect: jest.fn(),
        };
        handler(req, res);

        expect(rocketcrab.lobbyList[0].selectedGame).toEqual(req.params.gameid);
    });

    it("/game/:gameid works if gameid invalid", () => {
        expect(app.get.mock.calls[1][0]).toEqual("/game/:gameid");
        const handler = app.get.mock.calls[1][1];
        const req = {
            params: {
                gameid: "game-that-doesnt-exist",
            },
        };
        const res = {
            redirect: jest.fn(),
        };
        handler(req, res);

        expect(rocketcrab.lobbyList[0].selectedGame).toBe("");
    });
});
