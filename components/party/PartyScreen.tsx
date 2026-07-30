import PlayerList from "./PlayerList";
import PrimaryButton from "../common/PrimaryButton";
import { Spacer } from "@nextui-org/react";
import GameSelector from "../library/GameSelector";
import { ClientGameLibrary, ClientParty, Player } from "../../types/types";
import React, { useCallback, useContext, useState } from "react";
import PartyStatus from "./PartyStatus";
import GameDetail from "../detail/GameDetail";
import SkinnyCard from "../common/SkinnyCard";
import { Countdown } from "../find/Countdown";
import { ChatBox } from "../chat/ChatBox";
import AddAppButton from "../layout/AddAppButton";
import { useRouter } from "next/router";
import { isFuture } from "date-fns";
import { useIsAlreadyPWA } from "../../utils/useIsAlreadyPWA";
import { RocketcrabMode } from "../../types/enums";
import { ModalContext } from "../../pages/_app";
import ShareButtons from "./ShareButtons";

const PartyScreen = ({
    partyState,
    gameLibrary,
    thisPlayer,
    onSelectGame,
    onStartGame,
    resetName,
    onInOutParty,
    onSendChat,
    onKick,
    unreadMsgCount,
    clearUnreadMsgCount,
}: PartyScreenProps): JSX.Element => {
    const router = useRouter();
    const isKidsMode = router.locale === RocketcrabMode.KIDS;

    const {
        playerList,
        selectedGameId,
        isPublic,
        publicEndDate,
        createdAsPublic,
    } = partyState;
    const { id: meId, isHost } = thisPlayer;

    const selectedGame = gameLibrary.gameList.find(
        ({ id }) => id === selectedGameId,
    );
    const host = playerList.find(({ isHost }) => isHost);

    const isAlreadyPWA = useIsAlreadyPWA();

    const [gameSelectorVisible, setGameSelectorVisible] = useState(false);
    const [gameInfoVisible, setGameInfoVisible] = useState(false);

    const showGameSelector = (visibility) => () => {
        onInOutParty(visibility);
        setGameSelectorVisible(visibility);
    };

    const showGameInfo = (visibility) => () => {
        onInOutParty(visibility);
        setGameInfoVisible(visibility);
    };

    const leaveText = createdAsPublic
        ? "Back to Public Parties"
        : "Leave Party";

    const fireModal = useContext(ModalContext);

    const promptLeave = useCallback(() => {
        fireModal({
            title: "Are you sure?",
            showCancelButton: true,
            confirmButtonText: leaveText,
            icon: "warning",

            onClose: ({ isConfirmed }) => {
                if (isConfirmed) {
                    router.push("/");
                }
            },
        });
    }, [fireModal, leaveText, router]);

    if (gameSelectorVisible) {
        return (
            <GameSelector
                gameLibrary={gameLibrary}
                onSelectGame={onSelectGame}
                onDone={showGameSelector(false)}
                backToLabel="party"
                isHost={isHost}
                onSuggestGame={(gameName) => {
                    onSendChat(`I want to play ${gameName}!`);
                }}
            />
        );
    }

    if (gameInfoVisible) {
        return (
            <div style={{ textAlign: "center" }}>
                <GameDetail
                    game={selectedGame}
                    allCategories={gameLibrary.categories}
                />
                <PrimaryButton onClick={showGameInfo(false)}>
                    ↩️ Back to party
                </PrimaryButton>
            </div>
        );
    }

    const rChatBox = !isKidsMode && (
        <SkinnyCard key="ChatBox">
            <ChatBox
                chat={partyState.chat}
                onSendChat={onSendChat}
                thisPlayer={thisPlayer}
                startHidden={!isPublic}
                unreadMsgCount={unreadMsgCount}
                clearUnreadMsgCount={clearUnreadMsgCount}
            />
        </SkinnyCard>
    );

    const rPlayerList = (
        <SkinnyCard key="PlayerList">
            <PlayerList
                playerList={playerList}
                onEditName={resetName}
                meId={meId}
                startHidden={false}
                disableHideShow={false}
                onKick={onKick}
            />
        </SkinnyCard>
    );

    const orderedCards = createdAsPublic
        ? [rChatBox, rPlayerList]
        : [rPlayerList, rChatBox];

    return (
        <div className="flex flex-col justify-center space-y-4">
            <ShareButtons />
            <PartyStatus
                selectedGame={selectedGame}
                host={host}
                onShowGameInfo={showGameInfo(true)}
                isHost={isHost}
                onlyOnePlayer={playerList.length === 1}
                isPublic={isPublic}
            />
            <Spacer y={1} />
            <div className="flex justify-center space-x-2">
                <PrimaryButton onClick={showGameSelector(true)} size="lg">
                    Browse Games
                </PrimaryButton>
                <PrimaryButton
                    disabled={!selectedGameId || !isHost}
                    onClick={() => onStartGame()}
                    size="lg"
                    color={!selectedGameId || !isHost ? "default" : "success"}
                    variant="shadow"
                >
                    Start Game
                </PrimaryButton>
            </div>
            <Spacer y={1.5} />
            {orderedCards}
            {!isAlreadyPWA && !createdAsPublic && !isHost && !isKidsMode && (
                <>
                    <Spacer y={1} />
                    <SkinnyCard>
                        <div className="text-center p-1">
                            <div>
                                {host.name} is a great host, so don&apos;t{" "}
                                <div style={{ display: "inline-block" }}>
                                    tell them I said this... 🤫{" "}
                                </div>
                            </div>
                            <div>I think you&apos;d be even better! 😊 </div>
                            <div>
                                Just go to{" "}
                                <span
                                    style={{
                                        fontFamily: '"Inconsolata", monospace',
                                        fontWeight: "bold",
                                        fontSize: "1.05em",
                                    }}
                                >
                                    rocketcrab.com{" "}
                                </span>
                                anytime to host <i>your</i> friends and family!
                                Or, even better:
                            </div>
                            <div className="flex flex-col items-center py-3">
                                <AddAppButton />
                            </div>
                            No App Store download required! 😮
                        </div>
                    </SkinnyCard>
                </>
            )}

            {createdAsPublic && !isKidsMode && (
                <>
                    <Spacer y={0.5} />
                    <SkinnyCard>
                        <div>
                            {isPublic
                                ? "This is a public party! Anyone in the 🌏 can join without the code! But, they can't join if you haven't selected a game, and they can't join after you've started a game."
                                : "This public party is now closed. Have fun! 😀"}
                        </div>
                        {isFuture(publicEndDate) && (
                            <>
                                <Spacer y={0.5} />
                                <Countdown start={publicEndDate}>
                                    Public parties will close
                                </Countdown>
                            </>
                        )}
                    </SkinnyCard>
                </>
            )}

            <Spacer y={1} />
            <div className="flex justify-center space-x-2">
                <PrimaryButton onClick={promptLeave} size="sm">
                    {leaveText}
                </PrimaryButton>
            </div>
        </div>
    );
};

type PartyScreenProps = {
    partyState: ClientParty;
    gameLibrary: ClientGameLibrary;
    thisPlayer: Player;
    unreadMsgCount: number;
    clearUnreadMsgCount: () => void;
    onSelectGame: (gameId: string) => void;
    onStartGame: () => void;
    resetName: () => void;
    onInOutParty: (outOfParty: boolean) => void;
    onSendChat: (message: string) => void;
    onKick: (id: number, name: string) => void;
};

export default PartyScreen;
