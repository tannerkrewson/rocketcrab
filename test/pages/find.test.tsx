import React from "react";
import { render } from "../testUtils";
import Find from "../../pages/find";
import { ClientGameLibrary } from "../../types/types";
import { RocketcrabMode } from "../../types/enums";

jest.mock("next/router", () => ({
    useRouter: () => ({ locale: "MAIN" }),
}));

describe("pages/find.tsx", () => {
    it("matches snapshot", () => {
        const { asFragment } = render(
            <Find
                gameLibrary={{} as ClientGameLibrary}
                mode={RocketcrabMode.MAIN}
            />,
            {}
        );
        expect(asFragment()).toMatchSnapshot();
    });
});
