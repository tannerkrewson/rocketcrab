import React from "react";
import { render } from "../testUtils";
import { Code } from "../../pages/[code]";

jest.mock("next/router", () => ({
    useRouter: () => ({ query: "ijkl" }),
}));

describe("pages/[code].tsx", () => {
    it("matches snapshot", () => {
        const { asFragment } = render(<Code />, {});
        expect(asFragment()).toMatchSnapshot();
    });
});
