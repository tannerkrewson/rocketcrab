import Head from "next/head";

const Body = ({ children, themeType }: BodyProps): JSX.Element => {
    return (
        <>
            <Head>
                <title>rocketcrab</title>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
                <link
                    rel="apple-touch-icon"
                    sizes="180x180"
                    href="/apple-touch-icon.png"
                />
                <link
                    rel="icon"
                    type="image/png"
                    sizes="32x32"
                    href="/favicon-32x32.png"
                />
                <link
                    rel="icon"
                    type="image/png"
                    sizes="16x16"
                    href="/favicon-16x16.png"
                />
                <link rel="shortcut icon" href="/favicon.ico" />
                <link rel="manifest" href="/manifest.webmanifest" />
                <link
                    rel="mask-icon"
                    href="/safari-pinned-tab.svg"
                    color="#000000"
                />
                <meta name="msapplication-TileColor" content="#ffffff" />
                <meta name="theme-color" content="#ffffff" />
                <meta name="description" content="party games for phones" />
            </Head>
            <main className={themeType}>{children}</main>
            <style jsx global>{`
                html,
                body,
                #__next {
                    height: 100%;
                }
                * {
                    letter-spacing: normal !important;
                    font-family: "Mukta", sans-serif;
                }

                /* remove text-transform from "Description" element and buttons */
                dl.remove-text-transform dt,
                .btn .text {
                    text-transform: none;
                }

                .card.card.card,
                .card.card.card:hover {
                    box-shadow: 0 1px 6px rgba(32, 33, 36, 0.28);
                    border-color: rgba(223, 225, 229, 0);
                }

                .btn-col .btn.btn {
                    padding: 0 1.1em;
                    min-width: initial;
                }
            `}</style>
        </>
    );
};

type BodyProps = {
    children: React.ReactNode;
    themeType: string;
};

export default Body;
