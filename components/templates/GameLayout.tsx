import { GameStatus } from "../../types/enums";
import { Loading } from "@zeit-ui/react";
import PrimaryButton from "../atoms/PrimaryButton";
import { useState } from "react";
import { GameState, ClientGameLibrary } from "../../types/types";
import GameMenu from "../organisms/GameMenu";
import GameSelector from "../organisms/GameSelector";

const GameLayout = ({
    gameState,
    path,
    onExitGame,
    onStartGame,
    gameLibrary,
}: GameLayoutProps): JSX.Element => {
    const { status, url } = gameState;

    const [statusCollapsed, setStatusCollapsed] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [showGameLibrary, setShowGameLibrary] = useState(false);

    // https://stackoverflow.com/a/48830513
    const [frameRefresh, setFrameRefresh] = useState(0);

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
                    <>
                        <div className="url">rocketcrab.com/{path}</div>
                        <PrimaryButton
                            onClick={() => {
                                setShowMenu(!showMenu);
                                setShowGameLibrary(false);
                            }}
                            size="small"
                        >
                            {showMenu ? "▼" : "▲"} Menu
                        </PrimaryButton>

                        {showMenu && (
                            <GameMenu
                                onExitGame={() => {
                                    setShowMenu(false);
                                    onExitGame();
                                }}
                                onReloadMine={() => {
                                    setShowMenu(false);
                                    setFrameRefresh(frameRefresh + 1);
                                }}
                                onStartGame={() => {
                                    setShowMenu(false);
                                    onStartGame();
                                }}
                                onViewGames={() => {
                                    setShowMenu(false);
                                    setShowGameLibrary(true);
                                }}
                            />
                        )}
                    </>
                )}
            </div>
            {showLoading && (
                <div className="frame">
                    <Loading />
                </div>
            )}
            {showGameFrame && (
                <iframe className="frame" src={url} key={frameRefresh}></iframe>
            )}
            {showGameLibrary && (
                <div className="component-frame">
                    <GameSelector
                        gameLibrary={gameLibrary}
                        onDone={() => setShowGameLibrary(false)}
                        // eslint-disable-next-line @typescript-eslint/no-empty-function
                        onSelectGame={() => {}}
                        backToLabel="game"
                    />
                </div>
            )}
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
                    align-content: center;
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
                .url {
                    font-size: 1.2em;
                    line-height: 1em;
                    height: 1em;
                    margin: auto 0;
                    font-weight: bold;
                }
                .component-frame {
                    margin: 1em;
                    padding: 1em;
                    text-align: center;
                    position: absolute;
                    top: 3em;
                    background: white;
                    border: 1px solid LightGrey;
                }
            `}</style>
        </div>
    );
};

type GameLayoutProps = {
    gameState: GameState;
    path: string;
    onExitGame: () => void;
    onStartGame: () => void;
    gameLibrary: ClientGameLibrary;
};

export default GameLayout;
