import { GameStatus } from "../../types/enums";
import { Loading } from "@geist-ui/react";
import { ClientGame, GameState, Player } from "../../types/types";
import { useConnectedGame } from "../../utils/useConnectedGame";

const GameFrame = ({
    gameState,
    thisGame,
    onHostGameLoaded,
    thisPlayer,
    frameRefreshCount,
}: GameFrameProps): JSX.Element => {
    const { status, connectedGame } = gameState;

    const { isHost } = thisPlayer;

    const gameUrl = useConnectedGame(connectedGame, thisGame, thisPlayer);

    const showLoading = status === GameStatus.loading;
    const showError = status === GameStatus.error;
    const showWaitingForHost = !isHost && status === GameStatus.waitingforhost;
    const showGameFrame =
        (isHost && status === GameStatus.waitingforhost) ||
        status === GameStatus.inprogress;

    return (
        <>
            {(showLoading || showWaitingForHost) && (
                <div className="frame">
                    <Loading type={showWaitingForHost ? "error" : "default"}>
                        {showWaitingForHost ? (
                            <span>Waiting for host</span>
                        ) : (
                            <span>Loading game</span>
                        )}
                    </Loading>
                </div>
            )}
            {showError && (
                <div className="frame">
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            height: "100%",
                            flexDirection: "column",
                        }}
                    >
                        <h4>{gameState.error}</h4>
                        <p
                            style={{
                                color: "grey",
                                margin: "1em",
                                textAlign: "center",
                            }}
                        >
                            {thisGame.name} may be down. 😭 You can check{" "}
                            <a
                                href={thisGame.displayUrlHref}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {thisGame.displayUrlText}
                            </a>
                            , or try again later. If the problem continues, let
                            us know on{" "}
                            <a
                                href="https://discord.gg/MvYRVCP"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Discord
                            </a>{" "}
                            or{" "}
                            <a
                                href="https://github.com/tannerkrewson/rocketcrab/issues"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                GitHub
                            </a>
                            . 😃
                        </p>
                    </div>
                </div>
            )}
            {showGameFrame && (
                <iframe
                    className="frame"
                    src={gameUrl}
                    key={frameRefreshCount}
                    onLoad={isHost ? onHostGameLoaded : undefined}
                ></iframe>
            )}
            <style jsx>{`
                .frame {
                    flex: 1 1 auto;
                    border: 0;
                }
            `}</style>
        </>
    );
};

type GameFrameProps = {
    gameState: GameState;
    selectedGameId: string;
    onHostGameLoaded: () => void;
    thisPlayer: Player;
    frameRefreshCount: number;
    thisGame: ClientGame;
};

export default GameFrame;
