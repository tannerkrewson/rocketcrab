import { Badge, Button, Spacer } from "@nextui-org/react";
import PrimaryButton from "../common/PrimaryButton";
import React, { useCallback, useContext, useEffect, useState } from "react";
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
import { logEvent } from "../../utils/analytics";
import { filterClean, MODE_MAP } from "../../utils/utils";
import { differenceInMilliseconds } from "date-fns";
import GameDetail from "../detail/GameDetail";
import { RocketcrabMode } from "../../types/enums";
import { useRouter } from "next/router";
import { ModalContext } from "../../pages/_app";
import classNames from "classnames";
import { ToastContainer, toast } from "react-toastify";

import "react-toastify/dist/ReactToastify.css";
import { useDarkMode } from "next-dark-mode";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";

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
        ({ id }) => id == selectedGameId,
    );

    const [statusCollapsed, setStatusCollapsed] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [showGameLibrary, setShowGameLibrary] = useState(false);
    const [showPlayerList, setShowPlayerList] = useState(false);
    const [showChat, setShowChat] = useState(false);
    const [showGameInfo, setShowGameInfo] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    // https://stackoverflow.com/a/48830513
    const [frameRefresh, setFrameRefresh] = useState(0);

    const [enableToasts, setEnableToasts] = useState(!isKidsMode);

    const { darkModeActive } = useDarkMode();

    const igLogEvent = useCallback(
        (event) => logEvent("inGame-" + event, isHost ? "isHost" : "notHost"),
        [isHost],
    );

    const fireModal = useContext(ModalContext);

    const promptMute = useCallback(() => {
        fireModal({
            title: "Are your sure?",
            text: "New chat messages won't appear over your game, but you can still see them in the menu!",
            showCancelButton: true,
            confirmButtonText: "Mute chat",
            icon: "question",

            onClose: ({ isConfirmed }) => {
                if (isConfirmed) {
                    setEnableToasts(false);
                    igLogEvent("muteChat");
                }
            },
        });
    }, [fireModal, igLogEvent]);

    useEffect(() => {
        if (!newestMsg) return;

        const { playerId, playerName, message, date } = newestMsg;

        // is latest message over 3 seconds old
        const isLatestMessageOld =
            differenceInMilliseconds(Date.now(), date) > 3000;

        if (isLatestMessageOld) {
            return;
        }

        // don't show toasts if they were muted by the user
        if (!enableToasts) return;

        // don't show toasts if the chat is open
        if (showChat) return;

        // don't show toasts for your own messages
        if (playerId === thisPlayer.id) return;

        toast(
            <>
                <div className="flex items-center space-x-1">
                    <div>{playerName}: </div>

                    <div
                        className={classNames({
                            "text-4xl": message.length < 3,
                        })}
                    >
                        {filterClean(message)}
                    </div>
                </div>
            </>,
            {
                closeOnClick: true,
                onClick: () => {
                    setShowMenu(false);
                    setShowChat(true);
                    igLogEvent("toastChatReply");
                },
            },
        );

        igLogEvent("toastMsg");
    }, [enableToasts, igLogEvent, newestMsg, showChat, thisPlayer.id]);

    const hostName = playerList.find(({ isHost }) => isHost).name;

    const menuButtons: Array<MenuButton> = [
        {
            label: "Chat",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowChat(true);
                igLogEvent("showChat");
            }, [igLogEvent]),
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
            }, [igLogEvent]),
        },
        {
            label: "About this game",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowGameInfo(true);
                igLogEvent("gameInfo");
            }, [igLogEvent]),
        },
        {
            label: "Browse games",
            hostOnly: false,
            onClick: useCallback(() => {
                setShowMenu(false);
                setShowGameLibrary(true);
                igLogEvent("browseGames");
            }, [igLogEvent]),
        },
        {
            label: "Reload my game",
            hostOnly: false,
            onClick: useCallback(() => {
                fireModal({
                    title: "Are your sure?",
                    text:
                        "If reloading doesn't fix your issue, tell your party host, " +
                        hostName +
                        ", to try the Reload All button.",
                    showCancelButton: true,
                    confirmButtonText: `Reload my game`,
                    icon: "warning",

                    onClose: ({ isConfirmed }) => {
                        if (isConfirmed) {
                            setShowMenu(false);
                            setFrameRefresh(frameRefresh + 1);
                            igLogEvent("reloadMe");
                        }
                    },
                });
            }, [fireModal, frameRefresh, hostName, igLogEvent]),
        },
        {
            label: "Reload all",
            hostOnly: true,
            onClick: useCallback(() => {
                fireModal({
                    title: "Are your sure?",
                    text:
                        "Your current session in " +
                        thisGame.name +
                        " will be lost!",
                    showCancelButton: true,
                    confirmButtonText: `Reload All`,
                    icon: "warning",

                    onClose: ({ isConfirmed }) => {
                        if (isConfirmed) {
                            setShowMenu(false);
                            onStartGame();
                            igLogEvent("reloadAll");
                        }
                    },
                });
            }, [fireModal, igLogEvent, onStartGame, thisGame.name]),
        },
        {
            label: "Exit to party",
            hostOnly: true,
            onClick: useCallback(() => {
                fireModal({
                    title: "Are your sure?",
                    text:
                        "Your current session in " +
                        thisGame.name +
                        " will be lost!",
                    showCancelButton: true,
                    confirmButtonText: "Exit to party",
                    icon: "warning",

                    onClose: ({ isConfirmed }) => {
                        if (isConfirmed) {
                            setShowMenu(false);
                            onExitGame();
                            igLogEvent("exitToParty");
                        }
                    },
                });
            }, [fireModal, igLogEvent, onExitGame, thisGame.name]),
        },
    ];

    const combinedMenuBadgeCount = menuButtons.reduce(
        (prev, curr) => prev + (curr.badgeCount ?? 0),
        0,
    );

    const hideAllWindows = useCallback(() => {
        setShowGameLibrary(false);
        setShowPlayerList(false);
        setShowChat(false);
        setShowGameInfo(false);
        setShowEmojiPicker(false);
    }, [setShowGameLibrary, setShowPlayerList, setShowChat]);
    return (
        <div className="flex flex-col h-svh">
            <ToastContainer
                stacked
                hideProgressBar
                theme={darkModeActive ? "dark" : "light"}
            />
            <div
                className={classNames({
                    "flex flex-row justify-between shadow-sm z-10": true,
                    "status-collapsed": statusCollapsed,
                })}
            >
                <div
                    className="logo flex flex-row p-2 items-center"
                    onClick={() => {
                        setStatusCollapsed(!statusCollapsed);
                        setShowMenu(false);
                        hideAllWindows();
                        igLogEvent("clickLogo");
                    }}
                >
                    <img
                        src="/rocket.svg"
                        className="rocket"
                        alt="rocketcrab logo"
                    />
                    <img
                        src="/crab.svg"
                        className="crab"
                        alt="rocketcrab logo"
                    />
                </div>
                {!statusCollapsed && (
                    <>
                        <div className="url p-2">
                            {host}/{code}
                        </div>
                        <div className="p-2">
                            <Badge
                                color="danger"
                                isInvisible={
                                    showMenu || combinedMenuBadgeCount === 0
                                }
                                content={combinedMenuBadgeCount}
                                placement="bottom-left"
                            >
                                <PrimaryButton
                                    onClick={() => {
                                        setShowMenu(!showMenu);
                                        hideAllWindows();
                                        igLogEvent("clickMenu");
                                    }}
                                    size="sm"
                                >
                                    {showMenu ? "▲" : "▼"} Menu
                                </PrimaryButton>
                            </Badge>
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
            <Button
                radius="full"
                size="lg"
                isIconOnly
                variant="faded"
                onClick={() => {
                    setShowMenu(false);
                    setShowEmojiPicker(!showEmojiPicker);
                    igLogEvent("openEmojiPicker");
                }}
                className="fixed bottom-2 right-2"
            >
                {showEmojiPicker ? (
                    <img
                        src={`/close-${darkModeActive ? "dark" : "light"}.svg`}
                        alt="Close reaction button"
                        className="w-6"
                    />
                ) : (
                    <img
                        src={`/smile-${darkModeActive ? "dark" : "light"}.svg`}
                        alt="Reaction button"
                        className="w-8"
                    />
                )}
            </Button>
            <GameFrame
                gameState={gameState}
                selectedGameId={selectedGameId}
                onHostGameLoaded={onHostGameLoaded}
                thisPlayer={thisPlayer}
                thisGame={thisGame}
                frameRefreshCount={frameRefresh}
            />
            {showGameLibrary && (
                <div className="component-frame bg-background">
                    <GameSelector
                        gameLibrary={gameLibrary}
                        onDone={hideAllWindows}
                        onSelectGame={(gameId: string, gameName: string) => {
                            if (!isHost) return;

                            fireModal({
                                title: "Switch to " + gameName + "?",
                                text:
                                    "Your current session in " +
                                    thisGame.name +
                                    " will be lost!",
                                showCancelButton: true,
                                confirmButtonText: "Switch!",
                                icon: "warning",

                                onClose: ({ isConfirmed }) => {
                                    if (isConfirmed) {
                                        setShowMenu(false);
                                        onStartGame(gameId);
                                        igLogEvent("switchGame");
                                    }
                                },
                            });
                        }}
                        backToLabel="game"
                        isHost={isHost}
                    />
                </div>
            )}
            {showPlayerList && (
                <div className="component-frame bg-background">
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
                <div className="component-frame bg-background">
                    <ChatBox
                        chat={chat}
                        thisPlayer={thisPlayer}
                        onSendChat={onSendChat}
                        disableHideShow={true}
                        unreadMsgCount={unreadMsgCount}
                        clearUnreadMsgCount={clearUnreadMsgCount}
                    />
                    <Spacer y={0.5} />
                    <div className="flex mt-4 justify-center space-x-2">
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
                    </div>
                </div>
            )}
            {showGameInfo && (
                <div className="component-frame bg-background">
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
            {showEmojiPicker && (
                <div className="fixed bottom-2 left-2">
                    <EmojiPicker
                        reactionsDefaultOpen={true}
                        emojiStyle={"native" as EmojiStyle}
                        theme={(darkModeActive ? "dark" : "light") as Theme}
                        autoFocusSearch={false}
                        onEmojiClick={({ emoji }) => {
                            onSendChat(emoji);
                            hideAllWindows();
                        }}
                    />
                </div>
            )}
            <style jsx>{`
                .status-collapsed {
                    position: fixed;
                    border-radius: 8px;
                    top: 0.5em;
                    left: 0.5em;
                    backdrop-filter: blur(5px);
                    background-color: rgba(255, 255, 255, 0.2);
                    height: fit-content;
                }
                .logo {
                    margin: 0;
                    user-select: none;
                    cursor: pointer;
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
                    font-weight: bold;
                    font-family: "Inconsolata", monospace;
                }
                .component-frame {
                    padding: 1em;
                    text-align: center;
                    position: absolute;
                    top: 3em;
                    right: 0;
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
