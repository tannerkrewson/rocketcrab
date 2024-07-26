import { GameStatus } from "../../types/enums";
import { Spinner } from "@nextui-org/react";
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
        <div className="grow">
            {(showLoading || showWaitingForHost) && (
                <div className="flex h-full items-center justify-center">
                    <Spinner
                        color={showWaitingForHost ? "danger" : "default"}
                        label={
                            showWaitingForHost
                                ? "Waiting for host"
                                : "Loading game"
                        }
                    />
                </div>
            )}
            {showError && (
                <div className="h-full w-full flex items-center justify-center flex-col">
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
                        , or try again later. If the problem continues, let us
                        know on{" "}
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
            )}
            {showGameFrame && (
                <iframe
                    className="h-full w-full"
                    src={gameUrl}
                    key={frameRefreshCount}
                    onLoad={isHost ? onHostGameLoaded : undefined}
                ></iframe>
            )}
        </div>
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
