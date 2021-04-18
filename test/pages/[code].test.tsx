import React from "react";
import type { Socket } from "socket.io";
import { render } from "../testUtils";
import { Code } from "../../pages/[code]";
import { ClientGameLibrary } from "../../types/types";

jest.mock("next/router", () => ({
    useRouter: () => ({ query: "ijkl", locale: "MAIN" }),
}));

jest.mock("socket.io-client", () => ({
    io: () =>
        (({
            open: jest.fn(),
            on: jest.fn(),
            off: jest.fn(),
            close: jest.fn(),
            io: {
                on: jest.fn(),
                off: jest.fn(),
            },
        } as unknown) as Socket),
}));

describe("pages/[code].tsx", () => {
    it("matches snapshot", () => {
        const { asFragment } = render(
            <Code gameLibrary={{} as ClientGameLibrary} />,
            {}
        );
        expect(asFragment()).toMatchSnapshot();
    });
});
