const MainTitle = ({ path = "" }) => {
    const host = "rocketcrab.com";
    const title = host + (path !== "" ? "/" + path : "");

    return (
        <div className="title">
            <h2>🚀🦀</h2>
            <h2>{title}</h2>
            <style jsx>{`
                text-align: center;
            `}</style>
        </div>
    );
};

export default MainTitle;
