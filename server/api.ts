import { NextApiRequest, NextApiResponse } from "next";
import { newLobby } from "./rocketcrab";

export default (server, { lobbyList }) => {
    server.post("/api/new", (req: NextApiRequest, res: NextApiResponse) => {
        const code = newLobby(lobbyList);
        res.json({ code });
    });
};
