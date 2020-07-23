import React from "react";
import { render } from "../testUtils";
import { Code } from "../../pages/[code]";
import { ClientGameLibrary } from "../../types/types";

jest.mock("next/router", () => ({
    useRouter: () => ({ query: "ijkl" }),
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
