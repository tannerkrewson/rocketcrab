import { ReactGAImplementation } from "react-ga4";

// Use the named implementation export instead of the default export. The
// package's CommonJS/ESM interop shape can make the default export an object
// containing the GA4 instance when bundled by Vite/Rolldown.
const ReactGA = new ReactGAImplementation();

export const initGA = (): void => {
    ReactGA.initialize("G-V569CH5H2D");
};

export const logPageView = (): void => {
    ReactGA.set({ page: window.location.pathname });
    ReactGA.send({
        hitType: "pageview",
    });
};

export const logEvent = (category = "", action = ""): void => {
    if (category && action) {
        ReactGA.event({ category, action: String(action) });
    }
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const logException = (description = "", fatal = false): void => {
    if (description) {
        // https://github.com/codler/react-ga4/issues/40
        // ReactGA.exception({ description, fatal });
    }
};
