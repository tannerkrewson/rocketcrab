import { Spacer, useToasts } from "@geist-ui/react";
import PrimaryButton from "../common/PrimaryButton";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ClientGameLibrary,
    Player,
    MenuButton,
    ClientParty,
} from "../../types/types";
import GameMenu from "../in-game/GameMenu";
import GameSelector from "../library/GameSelector";
import PlayerList from "../party/PlayerList";
import GameFrame from "../in-game/GameFrame";
import Connecting from "./Connecting";
import { ChatBox } from "../chat/ChatBox";
import Swal from "sweetalert2";
import { ToastAction } from "@geist-ui/react/dist/use-toasts/use-toast";
import ButtonGroup from "../common/ButtonGroup";

const GameLayout = ({
    partyState,
    onExitGame,
    onStartGame,
    onHostGameLoaded,
    onSendChat,
    gameLibrary,
    thisPlayer,
    reconnecting,
}: GameLayoutProps): JSX.Element => {
    const { code, gameState, selectedGameId, playerList, chat } = partyState;
    const { isHost } = thisPlayer;
    const thisGame = gameLibrary.gameList.find(
        ({ id }) => id == selectedGameId
    );

    const [statusCollapsed, setStatusCollapsed] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [showGameLibrary, setShowGameLibrary] = useState(false);
    const [showPlayerList, setShowPlayerList] = useState(false);
    const [showChat, setShowChat] = useState(false);

    // https://stackoverflow.com/a/48830513
    const [frameRefresh, setFrameRefresh] = useState(0);

    const [enableToasts, setEnableToasts] = useState(true);
    const [, setToast] = useToasts();
    const [lastShownToastDate, setLastShownToastDate] = useState(-1);

    const actions = useMemo(
        (): ToastAction[] => [
            {
                name: "Mute",
                passive: true,
                handler: (event, cancel) => {
                    cancel();
                    promptMute();
                },
            },
            {
                name: "Reply",
                passive: true,
                handler: (event, cancel) => {
                    cancel();
                    setShowMenu(false);
                    setShowChat(true);
                },
            },
            {
                name: "Dismiss",
                passive: true,
                handler: (event, cancel) => cancel(),
            },
        ],
        []
    );

    useEffect(() => {
        if (chat.length === 0) return;

        const { playerId, playerName, message, date } = chat[chat.length - 1];

        // don't show a toast if it has already been shown
        // (this has to be done because every partyState update triggers a
        // "change" to `chat`, even if it hasn't actually changed, causing msgs
        // to be toasted multiple times)
        if (lastShownToastDate === date) return;
        setLastShownToastDate(date);

        // don't show toasts if they were muted by the user
        if (!enableToasts) return;

        // don't show toasts if the chat is open
        if (showChat) return;

        // don't show toasts for your own messages
        if (playerId === thisPlayer.id) return;

        setToast({ text: "🚀🦀 " + playerName + ": " + message, actions });
        setLastShownToastDate(date);
    }, [chat]);

    const hostName = playerList.find(({ isHost }) => isHost).name;

    const menuButtons: Array<MenuButton> = [
        {
            label: "Chat",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowChat(true);
            }, []),
        },
        {
            label: "Players",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowPlayerList(true);
            }, []),
        },
        {
            label: "Browse games",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowGameLibrary(true);
            }, []),
        },
        {
            label: "Reload my game",
            hostOnly: false,
            onClick: useCallback(() => {
                Swal.fire({
                    title: "Are your sure?",
                    text:
                        "If reloading doesn't fix your issue, tell your party host, " +
                        hostName +
                        ", to try the Reload All button.",
                    showCancelButton: true,
                    confirmButtonText: `Reload my game`,
                    icon: "warning",
                }).then(({ isConfirmed }) => {
                    if (isConfirmed) {
                        setShowMenu(false);
                        setFrameRefresh(frameRefresh + 1);
                    }
                });
            }, [frameRefresh]),
        },
        {
            label: "Reload all",
            hostOnly: true,
            onClick: useCallback(() => {
                Swal.fire({
                    title: "Are your sure?",
                    text:
                        "Your current session in " +
                        thisGame.name +
                        " will be lost!",
                    showCancelButton: true,
                    confirmButtonText: `Reload All`,
                    icon: "warning",
                }).then(({ isConfirmed }) => {
                    if (isConfirmed) {
                        setShowMenu(false);
                        onStartGame();
                    }
                });
            }, [onStartGame]),
        },
        {
            label: "Exit to party",
            hostOnly: true,
            onClick: useCallback(() => {
                Swal.fire({
                    title: "Are your sure?",
                    text:
                        "Your current session in " +
                        thisGame.name +
                        " will be lost!",
                    showCancelButton: true,
                    confirmButtonText: "Exit to party",
                    icon: "warning",
                }).then(({ isConfirmed }) => {
                    if (isConfirmed) {
                        setShowMenu(false);
                        onExitGame();
                    }
                });
            }, [onExitGame]),
        },
    ];

    const promptMute = () => {
        Swal.fire({
            title: "Are your sure?",
            text:
                "New chat messages won't appear over your game, but you can still see them in the menu!",
            showCancelButton: true,
            confirmButtonText: "Mute chat",
            icon: "question",
        }).then(({ isConfirmed }) => {
            if (isConfirmed) {
                setEnableToasts(false);
            }
        });
    };

    const hideAllWindows = useCallback(() => {
        setShowGameLibrary(false);
        setShowPlayerList(false);
        setShowChat(false);
    }, [setShowGameLibrary, setShowPlayerList, setShowChat]);

    const statusClass = "status " + (statusCollapsed ? "status-collapsed" : "");
    return (
        <div className="layout">
            <div className={statusClass}>
                <h4
                    className="logo"
                    onClick={() => {
                        setStatusCollapsed(!statusCollapsed);
                        setShowMenu(false);
                        hideAllWindows();
                    }}
                >
                    🚀🦀
                </h4>
                {!statusCollapsed && (
                    <>
                        <div className="url">rocketcrab.com/{code}</div>
                        <PrimaryButton
                            onClick={() => {
                                setShowMenu(!showMenu);
                                hideAllWindows();
                            }}
                            size="small"
                        >
                            {showMenu ? "▲" : "▼"} Menu
                        </PrimaryButton>

                        {showMenu && (
                            <GameMenu
                                isHost={isHost}
                                menuButtons={menuButtons}
                            />
                        )}
                    </>
                )}
            </div>
            <GameFrame
                gameState={gameState}
                selectedGameId={selectedGameId}
                onHostGameLoaded={onHostGameLoaded}
                thisPlayer={thisPlayer}
                thisGame={thisGame}
                frameRefreshCount={frameRefresh}
            />
            {showGameLibrary && (
                <div className="component-frame">
                    <GameSelector
                        gameLibrary={gameLibrary}
                        onDone={hideAllWindows}
                        // eslint-disable-next-line @typescript-eslint/no-empty-function
                        onSelectGame={() => {}}
                        backToLabel="game"
                        isHost={isHost}
                    />
                </div>
            )}
            {showPlayerList && (
                <div className="component-frame">
                    <div>🚀🦀 Players:</div>
                    <Spacer y={0.5} />
                    <PlayerList playerList={playerList} isPublic={false} />
                    <Spacer y={0.5} />
                    <PrimaryButton onClick={hideAllWindows}>
                        Close
                    </PrimaryButton>
                </div>
            )}
            {showChat && (
                <div className="component-frame">
                    <ChatBox
                        chat={chat}
                        thisPlayer={thisPlayer}
                        onSendChat={onSendChat}
                        disableHide={true}
                    />
                    <Spacer y={0.5} />
                    <ButtonGroup>
                        <PrimaryButton onClick={hideAllWindows}>
                            Close
                        </PrimaryButton>
                        <PrimaryButton
                            onClick={
                                enableToasts
                                    ? promptMute
                                    : () => setEnableToasts(true)
                            }
                        >
                            {enableToasts ? "Mute" : "Unmute"}
                        </PrimaryButton>
                    </ButtonGroup>
                </div>
            )}
            <style jsx>{`
                .layout {
                    display: flex;
                    flex-flow: column;
                    height: 100%;
                }
                .status {
                    border-bottom: 1px solid #ddd;
                    display: flex;
                    justify-content: space-between;
                    align-content: center;
                    padding: 0.5em;
                    height: 2em;
                    z-index: 1;
                }
                @media only screen and (max-width: 385px) {
                    .status {
                        font-size: 0.9em;
                        margin-bottom: 0em;
                    }
                    .logo {
                        line-height: 2em;
                        font-size: 1em;
                    }
                }
                .status-collapsed {
                    position: fixed;
                    width: fit-content;
                    border-right: 1px solid #ddd;
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
                    font-family: "Inconsolata", monospace;
                }
                .component-frame {
                    padding: 1em;
                    text-align: center;
                    position: absolute;
                    top: 3em;
                    right: 0;
                    background: white;
                    border: 1px solid #ddd;
                    width: min(24em, 100vw - 3em);
                    margin: 0.5em;
                    box-shadow: 0 1px 6px rgba(32, 33, 36, 0.28);
                }
            `}</style>
            {reconnecting && <Connecting />}
        </div>
    );
};

type GameLayoutProps = {
    partyState: ClientParty;
    onExitGame: () => void;
    onStartGame: () => void;
    onHostGameLoaded: () => void;
    onSendChat: (message: string) => void;
    gameLibrary: ClientGameLibrary;
    thisPlayer: Player;
    reconnecting: boolean;
};

export default GameLayout;
