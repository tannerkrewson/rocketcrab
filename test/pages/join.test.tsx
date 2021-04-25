import React from "react";
import { render } from "../testUtils";
import { Join } from "../../pages/join";
import { RocketcrabMode } from "../../types/enums";

jest.mock("next/router", () => ({
    useRouter: () => ({ query: { invalid: "wxyz" }, locale: "MAIN" }),
}));

describe("pages/join.tsx", () => {
    it("matches snapshot", () => {
        const { asFragment } = render(<Join mode={RocketcrabMode.MAIN} />, {});
        expect(asFragment()).toMatchSnapshot();
    });
});
