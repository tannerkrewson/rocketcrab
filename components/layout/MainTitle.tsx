import converter from "phonetic-alphabet-converter";
import { Tooltip } from "@geist-ui/react";
import { useCallback, useState } from "react";
import { Textfit } from "react-textfit";
import { RocketcrabMode } from "../../types/enums";
import { MODE_MAP } from "../../utils/utils";

const MainTitle = ({
    path = "",
    disablePhonetic,
    deemphasize,
    mode,
}: MainTitleProps): JSX.Element => {
    const host = MODE_MAP[mode];
    const title = host + (path ? "/" + path : "");

    const titleClasses = "title" + (deemphasize ? " deemphasize" : "");

    const [copiedTooltip, setCopiedTooltip] = useState(false);

    const linkCopyClick = useCallback(() => {
        setCopiedTooltip(true);
        navigator.clipboard.writeText(`https://${host}/${path}`);

        setTimeout(() => setCopiedTooltip(false), 1000);
    }, [path]);

    return (
        <div className={titleClasses}>
            <div style={{ margin: ".5em" }}>
                <img src="/rocket.svg" className="rocket" />
                <img src="/crab.svg" className="crab" />
            </div>
            <Textfit mode="single">
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
            </Textfit>

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

                    .logo {
                        margin: 0.5em;
                    }
                    .rocket {
                        height: 2.6em;
                        margin-right: 0.7em;
                        filter: drop-shadow(0 0 6px cyan);
                    }
                    .crab {
                        height: 2.6em;
                        filter: drop-shadow(0 0 6px #ff0000d9);
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
    mode: RocketcrabMode;
};

export default MainTitle;
