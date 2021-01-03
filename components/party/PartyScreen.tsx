import PlayerList from "./PlayerList";
import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";
import { Spacer } from "@geist-ui/react";
import GameSelector from "../library/GameSelector";
import { ClientGameLibrary, ClientParty, Player } from "../../types/types";
import React, { useState } from "react";
import PartyStatus from "./PartyStatus";
import GameDetail from "../detail/GameDetail";
import SkinnyCard from "../common/SkinnyCard";
import { Countdown } from "../find/Countdown";
import { ChatBox } from "../chat/ChatBox";

const PartyScreen = ({
    partyState,
    gameLibrary,
    thisPlayer,
    onSelectGame,
    onStartGame,
    resetName,
    onInOutParty,
    onSendChat,
}: PartyScreenProps): JSX.Element => {
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
                    onClick={onStartGame}
                    size="large"
                    type="error"
                >
                    Start Game
                </PrimaryButton>
            </ButtonGroup>
            <Spacer y={2} />
            {(isPublic || isOrWasPublic) && (
                <>
                    <Spacer y={0.5} />
                    <ChatBox chat={partyState.chat} onSendChat={onSendChat} />
                </>
            )}
            <PlayerList
                playerList={playerList}
                onEditName={resetName}
                meId={meId}
                isPublic={isPublic}
            />
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
            <PrimaryButton href="/" size="small">
                Leave Party
            </PrimaryButton>
        </div>
    );
};

type PartyScreenProps = {
    partyState: ClientParty;
    gameLibrary: ClientGameLibrary;
    thisPlayer: Player;
    onSelectGame: (gameId: string) => void;
    onStartGame: () => void;
    resetName: () => void;
    onInOutParty: (outOfParty: boolean) => void;
    onSendChat: (message: string) => void;
};

export default PartyScreen;
