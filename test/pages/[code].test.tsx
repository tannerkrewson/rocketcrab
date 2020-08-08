import React from "react";
import { render } from "../testUtils";
import { Code } from "../../pages/[code]";
import { ClientGameLibrary } from "../../types/types";

jest.mock("next/router", () => ({
    useRouter: () => ({ query: "ijkl" }),
}));

jest.mock("socket.io-client", () => ({
    __esModule: true,
    default: () =>
        (({
            open: jest.fn(),
            on: jest.fn(),
            close: jest.fn(),
        } as unknown) as SocketIO.Socket),
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
