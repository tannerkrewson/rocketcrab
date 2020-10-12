import PlayerList from "./PlayerList";
import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";
import { Spacer } from "@geist-ui/react";
import GameSelector from "../library/GameSelector";
import { Player, ClientGameLibrary } from "../../types/types";
import React, { useState } from "react";
import PartyStatus from "./PartyStatus";
import GameDetail from "../detail/GameDetail";

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
            />
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
};

export default PartyScreen;
