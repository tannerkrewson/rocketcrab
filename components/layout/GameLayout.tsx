import { Button } from "@heroui/react";
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
import { ModalContext } from "../../utils/ModalContext";
import classNames from "classnames";
import { ToastContainer, toast } from "react-toastify";

import "react-toastify/dist/ReactToastify.css";
import { useTheme } from "../../utils/theme";
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
    const [showEmojiButton, setShowEmojiButton] = useState(true);

    // https://stackoverflow.com/a/48830513
    const [frameRefresh, setFrameRefresh] = useState(0);

    const [enableToasts, setEnableToasts] = useState(!isKidsMode);

    const { isDark: darkModeActive } = useTheme();

    const igLogEvent = useCallback(
        (event) => logEvent("inGame-" + event, isHost ? "isHost" : "notHost"),
        [isHost],
    );

    const fireModal = useContext(ModalContext);

    const promptMute = useCallback(() => {
        fireModal({
            title: "Are you sure?",
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

        // is latest message over 2 seconds old
        const isLatestMessageOld =
            differenceInMilliseconds(Date.now(), date) > 2000;

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
            badgeCount: partyState?.playerList?.length,
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
                    title: "Are you sure?",
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
                    title: "Are you sure?",
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
                    title: "Are you sure?",
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
                    "fixed rounded-lg top-2 left-2 backdrop-blur-sm bg-white/20 h-fit":
                        statusCollapsed,
                })}
            >
                <div
                    className="m-0 select-none cursor-pointer flex flex-row p-2 items-center"
                    onClick={() => {
                        setStatusCollapsed(!statusCollapsed);
                        setShowMenu(false);
                        hideAllWindows();
                        igLogEvent("clickLogo");
                    }}
                >
                    <img
                        src="/rocket.svg"
                        className="h-6 ml-0.5"
                        style={{ filter: "drop-shadow(0 0 6px cyan)" }}
                        alt="rocketcrab logo"
                    />
                    <img
                        src="/crab.svg"
                        className="h-6 ml-1"
                        style={{ filter: "drop-shadow(0 0 6px #ff0000d9)" }}
                        alt="rocketcrab logo"
                    />
                </div>
                {!statusCollapsed && (
                    <>
                        <div className="text-lg font-bold font-mono p-2">
                            {host}/{code}
                        </div>
                        <div className="p-2">
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
            {showEmojiButton && (
                <Button
                    size="lg"
                    isIconOnly
                    variant="secondary"
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
            )}
            <GameFrame
                gameState={gameState}
                selectedGameId={selectedGameId}
                onHostGameLoaded={onHostGameLoaded}
                thisPlayer={thisPlayer}
                thisGame={thisGame}
                frameRefreshCount={frameRefresh}
            />
            {showGameLibrary && (
                <div className="p-4 text-center absolute top-12 right-0 w-[min(24em,calc(100vw-3em))] m-2 shadow-[0_1px_6px_rgba(32,33,36,0.28)] bg-background">
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
                        onSuggestGame={(gameName) => {
                            onSendChat(`I want to play ${gameName}!`);
                        }}
                        backToLabel="game"
                        isHost={isHost}
                    />
                </div>
            )}
            {showPlayerList && (
                <div className="p-4 text-center absolute top-12 right-0 w-[min(24em,calc(100vw-3em))] m-2 shadow-[0_1px_6px_rgba(32,33,36,0.28)] bg-background">
                    <PlayerList
                        playerList={playerList}
                        disableHideShow={true}
                        startHidden={false}
                        onKick={onKick}
                        disableEditName={true}
                        meId={thisPlayer.id}
                    />
                    <div className="h-2"></div>
                    <PrimaryButton onClick={hideAllWindows}>
                        Close
                    </PrimaryButton>
                </div>
            )}
            {showChat && (
                <div className="p-4 text-center absolute top-12 right-0 w-[min(24em,calc(100vw-3em))] m-2 shadow-[0_1px_6px_rgba(32,33,36,0.28)] bg-background">
                    <ChatBox
                        chat={chat}
                        thisPlayer={thisPlayer}
                        onSendChat={onSendChat}
                        disableHideShow={true}
                        unreadMsgCount={unreadMsgCount}
                        clearUnreadMsgCount={clearUnreadMsgCount}
                    />
                    <div className="h-2"></div>
                    <div className="flex mt-4 justify-center space-x-2">
                        <PrimaryButton
                            size="sm"
                            onClick={() => setShowEmojiButton(!showEmojiButton)}
                        >
                            {showEmojiButton
                                ? "Hide 🙂 Button"
                                : "Show 🙂 Button"}
                        </PrimaryButton>
                        <PrimaryButton
                            size="sm"
                            onClick={
                                enableToasts
                                    ? promptMute
                                    : () => setEnableToasts(true)
                            }
                        >
                            {enableToasts ? "Mute" : "Unmute"}
                        </PrimaryButton>
                        <PrimaryButton size="sm" onClick={hideAllWindows}>
                            Close
                        </PrimaryButton>
                    </div>
                </div>
            )}
            {showGameInfo && (
                <div className="p-4 text-center absolute top-12 right-0 w-[min(24em,calc(100vw-3em))] m-2 shadow-[0_1px_6px_rgba(32,33,36,0.28)] bg-background">
                    <GameDetail
                        game={thisGame}
                        allCategories={gameLibrary.categories}
                    />
                    <div className="h-2"></div>
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
