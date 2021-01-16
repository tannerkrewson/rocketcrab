import PlayerList from "./PlayerList";
import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";
import { Spacer } from "@geist-ui/react";
import GameSelector from "../library/GameSelector";
import { ClientGameLibrary, ClientParty, Player } from "../../types/types";
import React, { useCallback, useState } from "react";
import PartyStatus from "./PartyStatus";
import GameDetail from "../detail/GameDetail";
import SkinnyCard from "../common/SkinnyCard";
import { Countdown } from "../find/Countdown";
import { ChatBox } from "../chat/ChatBox";
import AddAppButton from "../layout/AddAppButton";
import Swal from "sweetalert2";
import { useRouter } from "next/router";

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

    const { playerList, selectedGameId, isPublic, publicEndDate } = partyState;
    const { id: meId, isHost } = thisPlayer;

    const selectedGame = gameLibrary.gameList.find(
        ({ id }) => id === selectedGameId
    );
    const host = playerList.find(({ isHost }) => isHost);

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

    const leaveText = isPublic ? "Back to Public Parties" : "Leave Party";

    const promptLeave = useCallback(() => {
        Swal.fire({
            title: "Are your sure?",
            showCancelButton: true,
            confirmButtonText: leaveText,
            icon: "warning",
        }).then(({ isConfirmed }) => {
            if (isConfirmed) {
                router.push(isPublic ? "/find" : "/");
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

    const isOrWasPublic = !!publicEndDate;

    const rChatBox = (
        <SkinnyCard>
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
        <SkinnyCard>
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

    const orderedCards = isOrWasPublic
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
            {!isPublic && !isHost && (
                <>
                    <Spacer y={1} />
                    <SkinnyCard>
                        <div>
                            {host.name} is a great host, so don&apos;t
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

            {isOrWasPublic && (
                <>
                    <Spacer y={0.5} />

                    <SkinnyCard>
                        {isPublic
                            ? "This is a public party! Anyone in the 🌏 can join without the code! But, they can't join if you haven't selected a game, and they can't join after you've started a game."
                            : "This public party is now closed. Have fun! 😀"}
                        {isPublic && (
                            <Countdown start={publicEndDate}>
                                Public parties will close
                            </Countdown>
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
};

export default PartyScreen;
