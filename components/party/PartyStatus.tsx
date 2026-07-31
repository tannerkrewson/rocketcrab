import { Card, CardBody } from "@heroui/react";

import spinners from "react-spinners-kit";

const { JellyfishSpinner } = spinners;
import { ClientGame, Player } from "../../types/types";
import PrimaryButton from "../common/PrimaryButton";

const PartyStatus = ({
    selectedGame,
    host: { name: hostName },
    onShowGameInfo,
    isHost,
    onlyOnePlayer,
    isPublic,
}: PartyStatusProps): JSX.Element => {
    return (
        <Card>
            <CardBody>
                {selectedGame ? (
                    <div className="text-center">
                        <div>
                            {isHost
                                ? "You've selected:"
                                : hostName + " has selected:"}
                        </div>

                        <div className="text-2xl my-1 font-bold">
                            {selectedGame.name}
                        </div>

                        <div className="my-2">
                            {isHost
                                ? "As the host, you have to start the game!"
                                : "Waiting for " + hostName + " to start..."}
                        </div>
                        <div className="h-4"></div>
                        <PrimaryButton onClick={onShowGameInfo} size="sm">
                            What is {selectedGame.name}?
                        </PrimaryButton>
                    </div>
                ) : (
                    <div className="flex">
                        <JellyfishSpinner size={4} sizeUnit="em" color="Grey" />

                        <div className="flex-1 flex items-center justify-center flex-col">
                            {getPreSelectedGameStatus(
                                onlyOnePlayer,
                                isHost,
                                hostName,
                                isPublic,
                            )
                                .split("\n")
                                .map((text, i) => (
                                    <div key={i}>{text}</div>
                                ))}
                        </div>
                    </div>
                )}
            </CardBody>
        </Card>
    );
};

const getPreSelectedGameStatus = (
    onlyOnePlayer: boolean,
    isHost: boolean,
    hostName: string,
    isPublic: boolean,
) => {
    if (isPublic) {
        return "You must select a game before others can join!";
    }

    return onlyOnePlayer
        ? "Welcome to Rocketcrab!"
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
