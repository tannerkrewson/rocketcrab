import { newLobby, setGame } from "./rocketcrab";
import { RocketCrab } from "../types/types";
import { Application, Request, Response } from "express";

export default (server: Application, { lobbyList }: RocketCrab): void => {
    server.post("/api/new", (req: Request, res: Response) => {
        const { code } = newLobby(lobbyList);
        res.json({ code });
    });
    server.get("/api/transfer", (req: Request, res: Response) => {
        const { uuid: givenUuid, gameid, name } = req.query;

        // uuid should be 36 characters long, but i'll be nice
        if (!givenUuid || givenUuid.length < 5) {
            res.status(400).end();
            return;
        }

        const lobby =
            lobbyList.find(({ uuid }) => uuid === givenUuid) ||
            newLobby(lobbyList, undefined, givenUuid as string);

        if (gameid && !lobby.selectedGame) {
            setGame(gameid as string, lobby);
            //TODO: fix stuck on waiting for host
            //startGame(lobby);
        }

        if (name) {
            res.cookie("previousName", name, {
                maxAge: 2147483647,
            });
        }

        res.redirect("/" + lobby.code);
    });
};
