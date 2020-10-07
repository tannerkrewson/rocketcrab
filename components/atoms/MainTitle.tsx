import converter from "phonetic-alphabet-converter";
import { Tooltip } from "@geist-ui/react";
import { useCallback, useState } from "react";

const MainTitle = ({
    path = "",
    disablePhonetic,
    deemphasize,
}: MainTitleProps): JSX.Element => {
    const host = "rocketcrab.com";
    const title = host + (path ? "/" + path : "");

    const titleClasses = "title" + (deemphasize ? " deemphasize" : "");

    const [copiedTooltip, setCopiedTooltip] = useState(false);

    const linkCopyClick = useCallback(() => {
        setCopiedTooltip(true);
        navigator.clipboard.writeText("https://rocketcrab.com/" + path);

        setTimeout(() => setCopiedTooltip(false), 1000);
    }, [path]);

    return (
        <div className={titleClasses}>
            <h2>
                <span style={{ textShadow: "0 0 10px cyan" }}>🚀</span>
                <span style={{ textShadow: "0 0 10px #ff0000d9" }}>🦀</span>
            </h2>
            <Tooltip
                text={"Copied!"}
                visible={copiedTooltip}
                trigger="click"
                type="dark"
                offset={-4}
            >
                <h2 className="party-url" onClick={linkCopyClick}>
                    {title}
                </h2>
            </Tooltip>

            {path && !disablePhonetic && (
                <div className="phonetic">({converter(path).join(" ")})</div>
            )}

            <style jsx>
                {`
                    .title {
                        transition: all 0.1s ease-out;
                        text-align: center;
                        margin: 2em 0 0 0;
                    }
                    .deemphasize {
                        margin-top: -0.25em;
                        margin-bottom: -2em;
                        transform: scale(0.75);
                        filter: saturate(50%) opacity(50%) blur(1px);
                    }

                    .party-url {
                        font-size: 1.7em;
                        cursor: pointer;
                        transform: scale(1);
                        transition: transform 0.2s ease-out;
                        user-select: none;
                        font-family: "Inconsolata", monospace;
                    }

                    .party-url:active {
                        transform: scale(0.9);
                    }

                    @media only screen and (min-width: 385px) {
                        .party-url {
                            font-size: 2.4em;
                        }
                    }

                    .phonetic {
                        margin-top: -0.6em;
                        margin-bottom: 1.5em;
                        font-size: 0.9em;
                        font-style: italic;
                    }
                `}
            </style>
        </div>
    );
};

type MainTitleProps = {
    path?: string;
    disablePhonetic?: boolean;
    deemphasize?: boolean;
};

export default MainTitle;
