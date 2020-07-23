import { ZeitProvider, CssBaseline } from "@zeit-ui/react";
import Body from "../components/templates/Body";
import "fontsource-inconsolata";
import { AppPropsType } from "next/dist/next-server/lib/utils";

const MyApp = ({ Component, pageProps }: AppPropsType): JSX.Element => (
    <ZeitProvider>
        <CssBaseline />
        <Body>
            <Component {...pageProps} />
        </Body>
    </ZeitProvider>
);

export default MyApp;
