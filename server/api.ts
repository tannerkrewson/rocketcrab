import { NextApiRequest, NextApiResponse } from "next";
import { newLobby } from "./rocketcrab";

export default (server, rocketCrab) => {
    server.post("/api/new", (req: NextApiRequest, res: NextApiResponse) => {
        const code = newLobby(rocketCrab);
        res.json({ code });
    });
};
