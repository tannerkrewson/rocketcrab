// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import { NextApiRequest, NextApiResponse } from "next";

const handler = (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") {
        res.status(404);
        res.end();
        return;
    }

    res.status(200).json({ code: "abcd" });
};

export default handler;
