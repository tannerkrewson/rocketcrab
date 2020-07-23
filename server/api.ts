import { newLobby } from "./rocketcrab";
import { RocketCrab } from "../types/types";
import { Application, Request, Response } from "express";

export default (server: Application, { lobbyList }: RocketCrab): void => {
    server.post("/api/new", (req: Request, res: Response) => {
        const code = newLobby(lobbyList);
        res.json({ code });
    });
};
