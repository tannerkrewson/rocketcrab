import { NextApiRequest, NextApiResponse } from "next";

export default (server) => {
    server.post("/api/new", (req: NextApiRequest, res: NextApiResponse) => {
        res.json({ code: "abcd" });
    });
};
