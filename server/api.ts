import { newParty, setGame } from "./rocketcrab";
import { RocketCrab } from "../types/types";
import { Application, Request, Response } from "express";
import { RocketcrabMode } from "../types/enums";

export default (server: Application, rocketcrab: RocketCrab): void => {
    const { partyList } = rocketcrab;

    const newPartyHandler = (isPublic: boolean) => (
        req: Request,
        res: Response
    ) => {
        if (isPublic && !rocketcrab.isFinderActive) {
            res.status(400).end();
            return;
        }

        const { code } = newParty({ rocketcrab, isPublic });
        res.json({ code });
    };

    const localeRedirects = [RocketcrabMode.MAIN, RocketcrabMode.KIDS].map(
        (mode) => `/${mode}/*`
    );

    // redirect https://rocketcrab.com/MAIN/transfer/drawphone
    //       to https://rocketcrab.com/transfer/drawphone
    // workaround because Next.js puts those MAIN and KIDS into
    // the Links
    server.all(localeRedirects, (req, res) => {
        const newPath = req.originalUrl.split("/");
        newPath.splice(1, 1); // removes second item from array
        res.redirect(newPath.join("/"));
    });

    server.post("/api/new", newPartyHandler(false));
    server.post("/api/new-public", newPartyHandler(true));

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
                newParty({ rocketcrab, forceUuid: givenUuid as string });
        } else {
            party = newParty({ rocketcrab });
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
