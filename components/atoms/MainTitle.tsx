const MainTitle = ({ path = "" }: MainTitleProps): JSX.Element => {
    const host = "rocketcrab.com";
    const title = host + (path !== "" ? "/" + path : "");

    return (
        <div className="title" style={{ textAlign: "center" }}>
            <h2>🚀🦀</h2>
            <h2>{title}</h2>
        </div>
    );
};

type MainTitleProps = {
    path?: string;
};

export default MainTitle;
