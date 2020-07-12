import { ZeitProvider, CssBaseline } from "@zeit-ui/react";
import Body from "../components/templates/Body";
import "fontsource-inconsolata";

const MyApp = ({ Component, pageProps }) => (
    <ZeitProvider>
        <CssBaseline />
        <Body>
            <Component {...pageProps} />
        </Body>
    </ZeitProvider>
);

export default MyApp;
