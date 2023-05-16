import { Card, Spacer, useTheme } from "@geist-ui/react";

import { JellyfishSpinner } from "react-spinners-kit";
import { ClientGame, Player } from "../../types/types";
import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";

const PartyStatus = ({
    selectedGame,
    host: { name: hostName },
    onShowGameInfo,
    isHost,
    onlyOnePlayer,
    isPublic,
}: PartyStatusProps): JSX.Element => {
    const {
        palette: { accents_1 },
    } = useTheme();

    return (
        <Card>
            <Card.Content
                style={{ padding: "1em", backgroundColor: accents_1 }}
            >
                {selectedGame ? (
                    <>
                        <div>Ready to play:</div>
                        <h3 className="game-name">{selectedGame.name}</h3>
                        <div>
                            {isHost
                                ? "As the host, you have to start the game!"
                                : "Waiting for " + hostName + " to start..."}
                        </div>
                        <Spacer h={1} />
                        <ButtonGroup>
                            <PrimaryButton
                                onClick={onShowGameInfo}
                                size="small"
                            >
                                What is {selectedGame.name}?
                            </PrimaryButton>
                        </ButtonGroup>
                    </>
                ) : (
                    <div className="status-container">
                        <JellyfishSpinner size={4} sizeUnit="em" color="Grey" />

                        <div className="status-note">
                            {getPreSelectedGameStatus(
                                onlyOnePlayer,
                                isHost,
                                hostName,
                                isPublic
                            )}
                        </div>
                    </div>
                )}
                <style jsx>{`
                    .game-name {
                        margin-top: 0.2em;
                        line-height: 1.2em;
                    }
                    .status-note {
                        flex: 1;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .status-container {
                        display: flex;
                    }
                `}</style>
            </Card.Content>
        </Card>
    );
};

const getPreSelectedGameStatus = (
    onlyOnePlayer: boolean,
    isHost: boolean,
    hostName: string,
    isPublic: boolean
) => {
    if (isPublic) {
        return "You must select a game before others can join!";
    }

    return onlyOnePlayer
        ? "⬆️ Give this link to your friends! ⬆️ \n (You can tap it to copy!)"
        : isHost
        ? "As the host, you must select the game!"
        : `Waiting for ${hostName} to select a game...`;
};

type PartyStatusProps = {
    selectedGame: ClientGame;
    host: Player;
    onShowGameInfo: () => void;
    isHost: boolean;
    onlyOnePlayer: boolean;
    isPublic: boolean;
};

export default PartyStatus;
