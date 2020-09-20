import converter from "phonetic-alphabet-converter";

const MainTitle = ({
    path = "",
    disablePhonetic,
    deemphasize,
}: MainTitleProps): JSX.Element => {
    const host = "rocketcrab.com";
    const title = host + (path !== "" ? "/" + path : "");

    const titleClasses = "title" + (deemphasize ? " deemphasize" : "");

    return (
        <div className={titleClasses}>
            <h2>🚀🦀</h2>
            <h2 className="party-url">{title}</h2>
            {path && !disablePhonetic && (
                <div className="phonetic">({converter(path).join(" ")})</div>
            )}

            <style jsx>
                {`
                    .title {
                        transition: all 0.1s ease-out;
                        text-align: center;
                    }
                    .deemphasize {
                        margin-bottom: -1.25em;
                        transform: scale(0.75);
                        filter: saturate(50%) opacity(50%) blur(1px);
                    }

                    .party-url {
                        font-size: 1.7em;
                    }

                    @media only screen and (min-width: 385px) {
                        .party-url {
                            font-size: 2.5em;
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
