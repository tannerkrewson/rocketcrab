import { GameStatus } from "../../types/enums";
import { Loading } from "@zeit-ui/react";
import PrimaryButton from "../atoms/PrimaryButton";
import { useState } from "react";

const GameLayout = ({ gameState, onExitGame }) => {
    const { status, url } = gameState;

    const [statusCollapsed, setStatusCollapsed] = useState(false);

    const showLoading = status === GameStatus.loading;
    const showGameFrame = status === GameStatus.inprogress;

    const statusClass = "status " + (statusCollapsed ? "status-collapsed" : "");
    return (
        <div className="layout">
            <div className={statusClass}>
                <h4
                    className="logo"
                    onClick={() => setStatusCollapsed(!statusCollapsed)}
                >
                    🚀🦀
                </h4>
                {!statusCollapsed && (
                    <PrimaryButton onClick={onExitGame} size="small">
                        Back to Lobby
                    </PrimaryButton>
                )}
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
                .status-collapsed {
                    position: fixed;
                    width: fit-content;
                    border-right: 1px solid LightGrey;
                }

                .frame {
                    flex: 1 1 auto;
                    border: 0;
                }
                .logo {
                    margin: 0;
                    user-select: none;
                    cursor: pointer;
                }
            `}</style>
        </div>
    );
};

export default GameLayout;
