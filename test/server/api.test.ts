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

    it("/transfer create lobby", () => {
        expect(app.get.mock.calls[0][0]).toEqual("/transfer/:gameid/:uuid?");
        const handler = app.get.mock.calls[0][1];
        const req = {
            params: {
                uuid: "1234567890",
                gameid: "tk-drawphone",
            },
            query: {
                name: "John",
            },
        };
        const res = {
            cookie: jest.fn(),
            redirect: jest.fn(),
        };
        handler(req, res);

        expect(rocketcrab.lobbyList[0].uuid).toEqual(req.params.uuid);
        expect(rocketcrab.lobbyList[0].selectedGame).toEqual(req.params.gameid);
        expect(res.cookie.mock.calls[0][1]).toEqual(req.query.name);
    });

    it("/transfer doesn't create lobby if already made", () => {
        const handler = app.get.mock.calls[0][1];
        const res = {
            cookie: jest.fn(),
            redirect: jest.fn(),
        };
        handler(
            {
                params: {
                    uuid: "1234567890",
                    gameid: "tk-drawphone",
                },
                query: {
                    name: "John",
                },
            },
            res
        );
        handler(
            {
                params: {
                    uuid: "1234567890",
                    gameid: "tk-drawphone",
                },
                query: {
                    name: "Jack",
                },
            },
            res
        );

        expect(rocketcrab.lobbyList.length).toEqual(1);
    });

    it("/transfer doesn't create lobby if uuid invalid", () => {
        const handler = app.get.mock.calls[0][1];
        const req = {
            params: {
                uuid: "12345",
            },
            query: {},
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

    it("/transfer works without uuid", () => {
        const handler = app.get.mock.calls[0][1];
        const req = {
            params: {
                gameid: "tk-drawphone",
            },
            query: {},
        };
        const res = {
            redirect: jest.fn(),
        };
        handler(req, res);

        expect(rocketcrab.lobbyList[0].selectedGame).toEqual(req.params.gameid);
    });

    it("/transfer works without uuid even if gameid invalid", () => {
        const handler = app.get.mock.calls[0][1];
        const req = {
            params: {
                gameid: "game-that-doesnt-exist",
            },
            query: {},
        };
        const res = {
            redirect: jest.fn(),
        };
        handler(req, res);

        expect(rocketcrab.lobbyList[0].selectedGame).toBe("");
    });
});
