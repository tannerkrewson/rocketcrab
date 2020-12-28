import { useRouter } from "next/router";
import React from "react";
import { ClientGameLibrary, ClientParty } from "../../types/types";
import PrimaryButton from "../common/PrimaryButton";
import SkinnyCard from "../common/SkinnyCard";

const PublicGame = ({
    party,
    gameLibrary,
}: {
    party: ClientParty;
    gameLibrary: ClientGameLibrary;
}): JSX.Element => {
    const { code, playerList, selectedGameId } = party;
    const router = useRouter();
    const selectedGame = gameLibrary.gameList.find(
        ({ id }) => id === selectedGameId
    );
    const host = playerList.find((p) => p.isHost);
    return (
        <SkinnyCard>
            <div className="public-game">
                <div>
                    <div>
                        {host.name}
                        &apos;s game{" "}
                        {selectedGame ? "of " + selectedGame.name : ""}
                    </div>
                    <div>
                        {playerList.length} player
                        {playerList.length !== 1 ? "s" : ""}
                    </div>
                </div>
                <PrimaryButton
                    onClick={() => router.push("/[code]", "/" + code)}
                >
                    Join
                </PrimaryButton>
            </div>
            <style jsx>{`
                .public-game {
                    display: flex;
                    justify-content: space-between;
                }
            `}</style>
        </SkinnyCard>
    );
};

export default PublicGame;
