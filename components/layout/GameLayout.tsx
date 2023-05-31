import { Badge, Spacer, useTheme, useToasts } from "@geist-ui/react";
import PrimaryButton from "../common/PrimaryButton";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ClientGameLibrary,
    Player,
    MenuButton,
    ClientParty,
    ChatMessage,
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
import { logEvent } from "../../utils/analytics";
import { filterClean, MODE_MAP } from "../../utils/utils";
import { differenceInMilliseconds } from "date-fns";
import GameDetail from "../detail/GameDetail";
import { RocketcrabMode } from "../../types/enums";
import { useRouter } from "next/router";

const GameLayout = ({
    partyState,
    onExitGame,
    onStartGame,
    onHostGameLoaded,
    onSendChat,
    gameLibrary,
    thisPlayer,
    reconnecting,
    onKick,
    unreadMsgCount,
    clearUnreadMsgCount,
    newestMsg,
    mode,
}: GameLayoutProps): JSX.Element => {
    const router = useRouter();
    const isKidsMode = router.locale === RocketcrabMode.KIDS;

    const host = MODE_MAP[mode];
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
    const [showGameInfo, setShowGameInfo] = useState(false);

    // https://stackoverflow.com/a/48830513
    const [frameRefresh, setFrameRefresh] = useState(0);

    const [enableToasts, setEnableToasts] = useState(!isKidsMode);
    const [, setToast] = useToasts();
    const [lastShownToastDate, setLastShownToastDate] = useState(0);

    const igLogEvent = useCallback(
        (event) => logEvent("inGame-" + event, isHost ? "isHost" : "notHost"),
        [isHost]
    );

    const {
        palette: { accents_1, accents_2 },
    } = useTheme();

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
                    igLogEvent("toastChatReply");
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
        if (!newestMsg) return;

        const { playerId, playerName, message, date } = newestMsg;

        const lastMessageCameInOverOneSecondAgo =
            differenceInMilliseconds(Date.now(), date) > 1000;

        // don't show a toast for an old message that happens to be the latest
        // when we are initializing
        if (!lastShownToastDate && lastMessageCameInOverOneSecondAgo) {
            setLastShownToastDate(date);
            return;
        }

        // don't show toasts if they were muted by the user
        if (!enableToasts) return;

        // don't show toasts if the chat is open
        if (showChat) return;

        // don't show toasts for your own messages
        if (playerId === thisPlayer.id) return;

        setToast({
            text: "🚀🦀 " + playerName + ": " + filterClean(message),
            actions,
        });

        igLogEvent("toastMsg");
    }, [newestMsg]);

    const hostName = playerList.find(({ isHost }) => isHost).name;

    const menuButtons: Array<MenuButton> = [
        {
            label: "Chat",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowChat(true);
                igLogEvent("showChat");
            }, []),
            badgeCount: unreadMsgCount,
            hide: isKidsMode,
        },
        {
            label: "Players",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowPlayerList(true);
                igLogEvent("showPlayers");
            }, []),
        },
        {
            label: "About this game",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowGameInfo(true);
                igLogEvent("gameInfo");
            }, []),
        },
        {
            label: "Browse games",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowGameLibrary(true);
                igLogEvent("browseGames");
            }, []),
        },
        {
            label: "Reload my game",
            hostOnly: false,
            onClick: useCallback(() => {
                Swal.fire({
                    title: "Are you sure?",
                    text:
                        "If reloading doesn't fix your issue, tell your party host, " +
                        hostName +
                        ", to try the Reload All button.",
                    showCancelButton: true,
                    confirmButtonText: `Reload my game`,
                    icon: "warning",
                    heightAuto: false,
                }).then(({ isConfirmed }) => {
                    if (isConfirmed) {
                        setShowMenu(false);
                        setFrameRefresh(frameRefresh + 1);
                        igLogEvent("reloadMe");
                    }
                });
            }, [frameRefresh]),
        },
        {
            label: "Reload all",
            hostOnly: true,
            onClick: useCallback(() => {
                Swal.fire({
                    title: "Are you sure?",
                    text:
                        "Your current session in " +
                        thisGame.name +
                        " will be lost!",
                    showCancelButton: true,
                    confirmButtonText: `Reload All`,
                    icon: "warning",
                    heightAuto: false,
                }).then(({ isConfirmed }) => {
                    if (isConfirmed) {
                        setShowMenu(false);
                        onStartGame();
                        igLogEvent("reloadAll");
                    }
                });
            }, [onStartGame]),
        },
        {
            label: "Exit to party",
            hostOnly: true,
            onClick: useCallback(() => {
                Swal.fire({
                    title: "Are you sure?",
                    text:
                        "Your current session in " +
                        thisGame.name +
                        " will be lost!",
                    showCancelButton: true,
                    confirmButtonText: "Exit to party",
                    icon: "warning",
                    heightAuto: false,
                }).then(({ isConfirmed }) => {
                    if (isConfirmed) {
                        setShowMenu(false);
                        onExitGame();
                        igLogEvent("exitToParty");
                    }
                });
            }, [onExitGame]),
        },
    ];

    const combinedMenuBadgeCount = menuButtons.reduce(
        (prev, curr) => prev + (curr.badgeCount ?? 0),
        0
    );

    const promptMute = () => {
        Swal.fire({
            title: "Are you sure?",
            text:
                "New chat messages won't appear over your game, but you can still see them in the menu!",
            showCancelButton: true,
            confirmButtonText: "Mute chat",
            icon: "question",
            heightAuto: false,
        }).then(({ isConfirmed }) => {
            if (isConfirmed) {
                setEnableToasts(false);
                igLogEvent("muteChat");
            }
        });
    };

    const hideAllWindows = useCallback(() => {
        setShowGameLibrary(false);
        setShowPlayerList(false);
        setShowChat(false);
        setShowGameInfo(false);
    }, [setShowGameLibrary, setShowPlayerList, setShowChat]);

    const statusClass = "status " + (statusCollapsed ? "status-collapsed" : "");
    return (
        <div className="layout">
            <div className={statusClass}>
                <div
                    className="logo"
                    onClick={() => {
                        setStatusCollapsed(!statusCollapsed);
                        setShowMenu(false);
                        hideAllWindows();
                        igLogEvent("clickLogo");
                    }}
                >
                    <img src="/rocket.svg" className="rocket" />
                    <img src="/crab.svg" className="crab" />
                </div>
                {!statusCollapsed && (
                    <>
                        <div className="url">
                            {host}/{code}
                        </div>
                        <div>
                            <Badge.Anchor placement="bottomLeft">
                                {!showMenu && combinedMenuBadgeCount > 0 && (
                                    <Badge type="error" size="mini">
                                        {combinedMenuBadgeCount}
                                    </Badge>
                                )}
                                <PrimaryButton
                                    onClick={() => {
                                        setShowMenu(!showMenu);
                                        hideAllWindows();
                                        igLogEvent("clickMenu");
                                    }}
                                    size="small"
                                >
                                    {showMenu ? "▲" : "▼"} Menu
                                </PrimaryButton>
                            </Badge.Anchor>
                        </div>

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
                        onSelectGame={(gameId: string, gameName: string) => {
                            if (!isHost) return;

                            Swal.fire({
                                title: "Switch to " + gameName + "?",
                                text:
                                    "Your current session in " +
                                    thisGame.name +
                                    " will be lost!",
                                showCancelButton: true,
                                confirmButtonText: "Switch!",
                                icon: "warning",
                                heightAuto: false,
                            }).then(({ isConfirmed }) => {
                                if (isConfirmed) {
                                    setShowMenu(false);
                                    onStartGame(gameId);
                                    igLogEvent("switchGame");
                                }
                            });
                        }}
                        backToLabel="game"
                        isHost={isHost}
                    />
                </div>
            )}
            {showPlayerList && (
                <div className="component-frame">
                    <PlayerList
                        playerList={playerList}
                        disableHideShow={true}
                        startHidden={false}
                        onKick={onKick}
                        disableEditName={true}
                        meId={thisPlayer.id}
                    />
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
                        disableHideShow={true}
                        unreadMsgCount={unreadMsgCount}
                        clearUnreadMsgCount={clearUnreadMsgCount}
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
            {showGameInfo && (
                <div className="component-frame">
                    <GameDetail
                        game={thisGame}
                        allCategories={gameLibrary.categories}
                    />
                    <Spacer y={0.5} />
                    <PrimaryButton onClick={hideAllWindows}>
                        Close
                    </PrimaryButton>
                </div>
            )}
            <style jsx>{`
                .layout {
                    display: flex;
                    flex-flow: column;
                    height: 100%;
                }
                .status {
                    border-bottom: 1px solid ${accents_2};
                    display: flex;
                    justify-content: space-between;
                    align-content: center;
                    padding: 0.5em;
                    height: 2em;
                    z-index: 1;
                    background-color: ${accents_1};
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
                    border: none;
                    border-radius: 8px;
                    top: 0.5em;
                    left: 0.5em;
                    backdrop-filter: blur(5px);
                    background-color: rgba(255, 255, 255, 0.2);
                }
                .logo {
                    margin: 0;
                    user-select: none;
                    cursor: pointer;
                    line-height: 2.8em;
                }
                .rocket {
                    height: 1.5em;
                    margin-left: 0.1em;
                    filter: drop-shadow(0 0 6px cyan);
                }
                .crab {
                    height: 1.5em;
                    margin-left: 0.25em;
                    filter: drop-shadow(0 0 6px #ff0000d9);
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
                    background: ${accents_1};
                    border: 1px solid ${accents_2};
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
    onStartGame: (gameId?: string) => void;
    onHostGameLoaded: () => void;
    onSendChat: (message: string) => void;
    gameLibrary: ClientGameLibrary;
    thisPlayer: Player;
    reconnecting: boolean;
    onKick: (id: number, name: string) => void;
    unreadMsgCount: number;
    newestMsg: ChatMessage;
    clearUnreadMsgCount: () => void;
    mode: RocketcrabMode;
};

export default GameLayout;
