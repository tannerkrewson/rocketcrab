import React from "react";
import { render } from "../testUtils";
import Find from "../../pages/find";
import { ClientGameLibrary } from "../../types/types";

describe("pages/find.tsx", () => {
    it("matches snapshot", () => {
        const { asFragment } = render(
            <Find gameLibrary={{} as ClientGameLibrary} />,
            {}
        );
        expect(asFragment()).toMatchSnapshot();
    });
});
