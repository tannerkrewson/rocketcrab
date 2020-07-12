import { GameStatus } from "../../types/enums";
import { Loading } from "@zeit-ui/react";
import PrimaryButton from "../atoms/PrimaryButton";

const GameLayout = ({ gameState, onExitGame }) => {
    const { status, url } = gameState;
    const showLoading = status === GameStatus.loading;
    const showGameFrame = status === GameStatus.inprogress;
    return (
        <div className="layout">
            <div className="status">
                <h4>🚀🦀</h4>
                <PrimaryButton onClick={onExitGame} size="small">
                    Back to Lobby
                </PrimaryButton>
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
                    height: 100%;
                }
                .status {
                    border-bottom: 1px solid LightGrey;
                    display: flex;
                    justify-content: space-between;
                    padding: 0.5em;
                }
                .frame {
                    flex: 1 1 auto;
                    border: 0;
                }
                h4 {
                    margin: 0;
                }
            `}</style>
        </div>
    );
};

export default GameLayout;
