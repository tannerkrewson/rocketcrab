import { GameStatus } from "../../types/enums";
import { Loading } from "@zeit-ui/react";

const GameLayout = ({ gameState }) => {
    const { status, url } = gameState;
    const showLoading = status === GameStatus.loading;
    const showGameFrame = status === GameStatus.inprogress;
    return (
        <div className="layout">
            <div className="status">
                <h4>🚀🦀 rocketcrab</h4>
            </div>
            {showLoading && (
                <div className="frame">
                    <Loading />
                </div>
            )}
            {showGameFrame && <iframe className="frame" src={url}></iframe>}
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
        </div>
    );
};

export default GameLayout;
