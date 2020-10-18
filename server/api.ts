import { newParty, setGame } from "./rocketcrab";
import { RocketCrab } from "../types/types";
import { Application, Request, Response } from "express";

export default (server: Application, { partyList }: RocketCrab): void => {
    server.post("/api/new", (req: Request, res: Response) => {
        const { code } = newParty({ partyList });
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

        let party;
        if (givenUuid) {
            party =
                partyList.find(({ uuid }) => uuid === givenUuid) ||
                newParty({ partyList, forceUuid: givenUuid as string });
        } else {
            party = newParty({ partyList });
        }

        if (gameid && !party.selectedGame) {
            setGame(gameid as string, party);
            //TODO: fix stuck on waiting for host
            //startGame(party);
        }

        if (name) {
            res.cookie("previousName", name, {
                maxAge: 2147483647,
            });
        }

        res.redirect("/" + party.code);
    });
    server.get("/api/stats", (req: Request, res: Response) => {
        res.json(
            partyList.map(
                ({ status, gameState, selectedGameId, playerList }) => ({
                    partyStatus: status,
                    gameStatus: gameState.status,
                    selectedGameId,
                    numberOfPlayers: playerList.length,
                })
            )
        );
    });
};
