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
            <h2>{title}</h2>
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
        </div>
    );
};

type MainTitleProps = {
    path?: string;
    disablePhonetic?: boolean;
};

export default MainTitle;
