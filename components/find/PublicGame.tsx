import React from "react";
import { ClientGameLibrary, ClientParty } from "../../types/types";
import PrimaryButton from "../common/PrimaryButton";
import SkinnyCard from "../common/SkinnyCard";

const PublicGame = ({
    party,
    gameLibrary,
    onWhatIs,
}: {
    party: ClientParty;
    gameLibrary: ClientGameLibrary;
    onWhatIs: (gameId: string) => void;
}): JSX.Element => {
    const { code, playerList, selectedGameId } = party;
    const selectedGame = gameLibrary.gameList.find(
        ({ id }) => id === selectedGameId,
    );
    const host = playerList.find((p) => p.isHost);
    return (
        <SkinnyCard>
            <div className="public-game">
                <div>
                    <div>
                        {host.name}
                        &apos;s game{" "}
                        {selectedGame ? (
                            <span>
                                of{" "}
                                <a
                                    onClick={() => onWhatIs(selectedGameId)}
                                    className="game-info"
                                >
                                    {selectedGame.name} ❓
                                </a>
                            </span>
                        ) : (
                            ""
                        )}
                    </div>
                    <div>
                        {playerList.length} player
                        {playerList.length !== 1 ? "s" : ""}
                    </div>
                </div>
                <PrimaryButton href={"/" + code}>Join</PrimaryButton>
            </div>
            <style jsx>{`
                .public-game {
                    display: flex;
                    justify-content: space-between;
                }
                .game-info {
                    display: inline-flex;
                    justify-content: space-between;
                }
            `}</style>
        </SkinnyCard>
    );
};

export default PublicGame;
