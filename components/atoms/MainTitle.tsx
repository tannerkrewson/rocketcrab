import converter from "phonetic-alphabet-converter";

const MainTitle = ({
    path = "",
    disablePhonetic,
}: MainTitleProps): JSX.Element => {
    const host = "rocketcrab.com";
    const title = host + (path !== "" ? "/" + path : "");

    return (
        <div className="title" style={{ textAlign: "center" }}>
            <h2>🚀🦀</h2>
            <h2 className="lobby-url">{title}</h2>
            {path && !disablePhonetic && (
                <div
                    style={{
                        marginTop: "-.6em",
                        marginBottom: "1.5em",
                        fontSize: ".9em",
                        fontStyle: "italic",
                    }}
                >
                    ({converter(path).join(" ")})
                </div>
            )}

            <style jsx>
                {`
                    .lobby-url {
                        font-size: 1.7em;
                    }

                    @media only screen and (min-width: 385px) {
                        .lobby-url {
                            font-size: 2.5em;
                        }
                    }
                `}
            </style>
        </div>
    );
};

type MainTitleProps = {
    path?: string;
    disablePhonetic?: boolean;
};

export default MainTitle;
