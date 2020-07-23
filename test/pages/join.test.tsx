import React from "react";
import { render } from "../testUtils";
import { Join } from "../../pages/join";

jest.mock("next/router", () => ({
    useRouter: () => ({ query: { invalid: "wxyz" } }),
}));

describe("pages/join.tsx", () => {
    it("matches snapshot", () => {
        const { asFragment } = render(<Join />, {});
        expect(asFragment()).toMatchSnapshot();
    });
});
