import { ZeitProvider, CssBaseline } from "@zeit-ui/react";

const MyApp = ({ Component, pageProps }) => (
    <ZeitProvider>
        <CssBaseline />
        <Component {...pageProps} />
    </ZeitProvider>
);

export default MyApp;
