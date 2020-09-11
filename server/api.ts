import { newLobby, setGame } from "./rocketcrab";
import { RocketCrab } from "../types/types";
import { Application, Request, Response } from "express";

export default (server: Application, { lobbyList }: RocketCrab): void => {
    server.post("/api/new", (req: Request, res: Response) => {
        const { code } = newLobby(lobbyList);
        res.json({ code });
    });
    server.get("/transfer/:gameid/:uuid?", (req: Request, res: Response) => {
        const { uuid: givenUuid, gameid } = req.params;
        const { name } = req.query;

        // uuid should be 36 characters long, but i'll be nice
        if (givenUuid && givenUuid.length < 10) {
            res.status(400).end();
            return;
        }

        let lobby;
        if (givenUuid) {
            lobby =
                lobbyList.find(({ uuid }) => uuid === givenUuid) ||
                newLobby(lobbyList, undefined, givenUuid as string);
        } else {
            lobby = newLobby(lobbyList);
        }

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
    server.get("/api/stats", (req: Request, res: Response) => {
        res.json(
            lobbyList.map(
                ({ status, gameState, selectedGameId, playerList }) => ({
                    lobbyStatus: status,
                    gameStatus: gameState.status,
                    selectedGameId,
                    numberOfPlayers: playerList.length,
                })
            )
        );
    });
};
