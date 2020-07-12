const GameLayout = () => {
    return (
        <div className="layout">
            <div className="status">
                <h4>🚀🦀 rocketcrab</h4>
            </div>
            <iframe
                className="frame"
                src="https://spyfall.tannerkrewson.com/"
            ></iframe>
            <style jsx>{`
                .layout {
                    display: flex;
                    flex-flow: column;
                    height: 100vh;
                }
                .status {
                    border-bottom: 1px solid LightGrey;
                }
                .frame {
                    flex: 1 1 auto;
                    border: 0;
                }
            `}</style>
            <style jsx global>{`
                @import url("https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;600&display=swap");

                * {
                    letter-spacing: normal !important;
                    font-family: "Inconsolata", monospace;
                }
            `}</style>
        </div>
    );
};

export default GameLayout;
