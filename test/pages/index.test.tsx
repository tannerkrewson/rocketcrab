import React from "react";
import { render } from "../testUtils";
import { Home } from "../../pages/index";
import { RocketcrabMode } from "../../types/enums";

Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(), // deprecated
        removeListener: jest.fn(), // deprecated
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
    })),
});

describe("pages/index.tsx", () => {
    it("matches snapshot", () => {
        const { asFragment } = render(<Home mode={RocketcrabMode.MAIN} />, {});
        expect(asFragment()).toMatchSnapshot();
    });
});
