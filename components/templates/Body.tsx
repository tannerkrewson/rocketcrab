import Head from "next/head";

const Body = ({ children }: BodyProps): JSX.Element => (
    <>
        <Head>
            <title>🚀🦀 rocketcrab</title>
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
        {children}
        <style jsx global>{`
            html,
            body,
            #__next {
                height: 100%;
            }
            * {
                letter-spacing: normal !important;
                font-family: "Inconsolata", monospace;
            }

            /* remove text-transform from "Description" element and buttons */
            dl.remove-text-transform dt,
            .btn .text {
                text-transform: none;
            }

            /* fixes a weird geist bug where the dashes of unordered list move when you scroll */
            .container ul li:before {
                margin-right: 0.5em;
                position: initial;
                content: "•";
            }

            /* "Copied!" tooltip animation */
            #geist-ui-tooltip .tooltip-content.transition-enter {
                opacity: 0;
            }
            #geist-ui-tooltip .tooltip-content.transition-enter-active {
                transition: opacity 0.2s ease-out;
                opacity: 1;
            }
            #geist-ui-tooltip .tooltip-content.transition-leave {
                opacity: 1;
            }
            #geist-ui-tooltip .tooltip-content.transition-leave-active {
                transition: opacity 0.2s ease-out;
                opacity: 0;
            }
        `}</style>
    </>
);

type BodyProps = {
    children: React.ReactNode;
};

export default Body;
