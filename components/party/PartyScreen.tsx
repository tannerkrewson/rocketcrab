import PlayerList from "./PlayerList";
import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";
import { Spacer } from "@geist-ui/react";
import GameSelector from "../library/GameSelector";
import { Player, ClientGameLibrary } from "../../types/types";
import React, { useState } from "react";
import PartyStatus from "./PartyStatus";
import GameDetail from "../detail/GameDetail";
import SkinnyCard from "../common/SkinnyCard";

const PartyScreen = ({
    playerList,
    gameLibrary,
    onSelectGame,
    selectedGameId,
    onStartGame,
    resetName,
    meId,
    isHost,
    onInOutParty,
    isPublic,
}: PartyScreenProps): JSX.Element => {
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
            <PlayerList
                playerList={playerList}
                onEditName={resetName}
                meId={meId}
                isPublic={isPublic}
            />
            {isPublic && (
                <>
                    <Spacer y={0.5} />
                    <SkinnyCard>
                        This is a public party! Anyone in the 🌏 can join
                        without the code! But, they can&apos;t join if you
                        haven&apos;t selected a game, and they can&apos;t join
                        after you&apos;ve started a game.
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
    playerList: Array<Player>;
    gameLibrary: ClientGameLibrary;
    onSelectGame: (gameId: string) => void;
    selectedGameId: string;
    onStartGame: () => void;
    resetName: () => void;
    meId: number;
    isHost: boolean;
    onInOutParty: (outOfParty: boolean) => void;
    isPublic: boolean;
};

export default PartyScreen;
