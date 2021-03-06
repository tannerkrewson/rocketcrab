import React from "react";
import { render } from "../testUtils";
import Library from "../../pages/library";
import { ClientGameLibrary } from "../../types/types";
import { RocketcrabMode } from "../../types/enums";

jest.mock("next/router", () => ({
    useRouter: () => ({ locale: "MAIN" }),
}));

describe("pages/library.tsx", () => {
    it("matches snapshot", () => {
        const { asFragment } = render(
            <Library
                gameLibrary={{} as ClientGameLibrary}
                mode={RocketcrabMode.MAIN}
            />,
            {}
        );
        expect(asFragment()).toMatchSnapshot();
    });
});
