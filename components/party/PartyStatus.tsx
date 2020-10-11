import { Card, Spacer } from "@geist-ui/react";

import { JellyfishSpinner } from "react-spinners-kit";
import { ClientGame, Player } from "../../types/types";
import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";

const PartyStatus = ({
    selectedGame,
    host: { name: hostName },
    onShowGameInfo,
    isHost,
}: PartyStatusProps): JSX.Element => (
    <Card>
        <Card.Content style={{ padding: "1em" }}>
            {selectedGame ? (
                <>
                    <div>Ready to play:</div>
                    <h3
                        style={{
                            marginTop: ".2em",
                            lineHeight: "1.2em",
                        }}
                    >
                        {selectedGame.name}
                    </h3>
                    <div>
                        {isHost
                            ? "As the host, you have to start the game!"
                            : "Waiting for " + hostName + " to start..."}
                    </div>
                    <Spacer y={1} />
                    <ButtonGroup>
                        <PrimaryButton onClick={onShowGameInfo} size="small">
                            What is {selectedGame.name}?
                        </PrimaryButton>
                    </ButtonGroup>
                </>
            ) : (
                <div style={{ display: "flex" }}>
                    <span style={{ minWidth: "4em" }}>
                        <JellyfishSpinner size={4} sizeUnit="em" color="Grey" />
                    </span>

                    <div
                        style={{
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            lineHeight: "1.2em",
                        }}
                    >
                        {isHost
                            ? "As the host, you must select the game!"
                            : "Waiting for " +
                              hostName +
                              " to select a game..."}
                    </div>
                </div>
            )}
        </Card.Content>
    </Card>
);

type PartyStatusProps = {
    selectedGame: ClientGame;
    host: Player;
    onShowGameInfo: () => void;
    isHost: boolean;
};

export default PartyStatus;
