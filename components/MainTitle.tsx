const MainTitle = () => {
    const host = "rocketcrab.com"; // window.location.host
    const path = ""; // window.location.pathname === "/" ? "" : window.location.pathname;
    const title = host + path;

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
