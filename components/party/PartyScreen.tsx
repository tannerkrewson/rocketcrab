import PlayerList from "./PlayerList";
import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";
import { Spacer } from "@geist-ui/react";
import GameSelector from "../library/GameSelector";
import { ClientGameLibrary, ClientParty, Player } from "../../types/types";
import React, { useCallback, useEffect, useState } from "react";
import PartyStatus from "./PartyStatus";
import GameDetail from "../detail/GameDetail";
import SkinnyCard from "../common/SkinnyCard";
import { Countdown } from "../find/Countdown";
import { ChatBox } from "../chat/ChatBox";
import AddAppButton from "../layout/AddAppButton";
import Swal from "sweetalert2";
import { useRouter } from "next/router";
import { isFuture } from "date-fns";
import { useIsAlreadyPWA } from "../../utils/useIsAlreadyPWA";

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
    onSetIsPublic,
    unreadMsgCount,
    clearUnreadMsgCount,
}: PartyScreenProps): JSX.Element => {
    const router = useRouter();

    const {
        playerList,
        selectedGameId,
        isPublic,
        publicEndDate,
        isFinderActive,
        createdAsPublic,
    } = partyState;
    const { id: meId, isHost } = thisPlayer;

    const selectedGame = gameLibrary.gameList.find(
        ({ id }) => id === selectedGameId
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

    const [awaitingChangeToIsPublic, setAwaitingChangeToIsPublic] = useState(
        false
    );

    useEffect(() => setAwaitingChangeToIsPublic(false), [isPublic]);

    const leaveText = createdAsPublic
        ? "Back to Public Parties"
        : "Leave Party";

    const promptLeave = useCallback(() => {
        Swal.fire({
            title: "Are your sure?",
            showCancelButton: true,
            confirmButtonText: leaveText,
            icon: "warning",
            heightAuto: false,
        }).then(({ isConfirmed }) => {
            if (isConfirmed) {
                router.push(createdAsPublic ? "/find" : "/");
            }
        });
    }, [isPublic]);

    if (gameSelectorVisible) {
        return (
            <GameSelector
                gameLibrary={gameLibrary}
                onSelectGame={onSelectGame}
                onDone={showGameSelector(false)}
                backToLabel="party"
                isHost={isHost}
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

    const rChatBox = (
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
        <div style={{ textAlign: "center" }}>
            <Spacer y={1.25} />
            <PartyStatus
                selectedGame={selectedGame}
                host={host}
                onShowGameInfo={showGameInfo(true)}
                isHost={isHost}
                onlyOnePlayer={playerList.length === 1}
                isPublic={isPublic}
            />
            <Spacer y={1} />
            <ButtonGroup>
                <PrimaryButton onClick={showGameSelector(true)} size="large">
                    Browse Games
                </PrimaryButton>
                <PrimaryButton
                    disabled={!selectedGameId || !isHost}
                    onClick={() => onStartGame()}
                    size="large"
                    type="error"
                >
                    Start Game
                </PrimaryButton>
            </ButtonGroup>
            <Spacer y={1.5} />
            {orderedCards}
            {!isAlreadyPWA && !createdAsPublic && !isHost && (
                <>
                    <Spacer y={1} />
                    <SkinnyCard>
                        <div>
                            {host.name} is a great host, so don&apos;t{" "}
                            <div style={{ display: "inline-block" }}>
                                tell them I said this... 🤫{" "}
                            </div>
                        </div>
                        <Spacer y={0.5} />
                        <div>
                            I think you&apos;d be even better! 😊 Just go to{" "}
                            <span
                                style={{
                                    fontFamily: '"Inconsolata", monospace',
                                    fontWeight: "bold",
                                    fontSize: "1.05em",
                                }}
                            >
                                rocketcrab.com{"  "}
                            </span>
                            anytime to host <i>your</i> friends and family! Or,
                            even better:
                        </div>
                        <Spacer y={0.5} />
                        <ButtonGroup>
                            <AddAppButton />
                        </ButtonGroup>
                        <Spacer y={0.5} />
                        No App Store download required! 😮
                    </SkinnyCard>
                </>
            )}

            {createdAsPublic && (
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
                        {selectedGame && isFinderActive && (
                            <>
                                <Spacer y={0.5} />
                                <PrimaryButton
                                    onClick={() => {
                                        if (!isHost || awaitingChangeToIsPublic)
                                            return;
                                        onSetIsPublic(!isPublic);
                                        setAwaitingChangeToIsPublic(true);
                                    }}
                                    loading={awaitingChangeToIsPublic}
                                    disabled={!isHost}
                                >
                                    {isPublic
                                        ? "Close to new players"
                                        : "Open to public"}
                                </PrimaryButton>
                                <Spacer y={0.5} />
                            </>
                        )}
                    </SkinnyCard>
                </>
            )}

            <Spacer y={1} />
            <PrimaryButton onClick={promptLeave} size="small">
                {leaveText}
            </PrimaryButton>
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
    onSetIsPublic: (isPublic: boolean) => void;
};

export default PartyScreen;
