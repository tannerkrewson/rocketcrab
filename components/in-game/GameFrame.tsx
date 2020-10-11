import { GameStatus } from "../../types/enums";
import { Loading } from "@geist-ui/react";
import { ClientGame, GameState, Player } from "../../types/types";

const GameFrame = ({
    gameState,
    thisGame,
    onHostGameLoaded,
    thisPlayer,
    frameRefreshCount,
}: GameFrameProps): JSX.Element => {
    const {
        status,
        joinGameURL: { playerURL, hostURL, code },
    } = gameState;

    const { renameParams } = thisGame;
    const { name, isHost } = thisPlayer;

    const paramKeys = {
        rocketcrab: "rocketcrab",
        name: "name",
        ishost: "ishost",
        ...(code ? { code: "code" } : {}),
        ...renameParams,
    };

    const defaultParams = {
        rocketcrab: "true",
        name,
        ishost: isHost.toString(),
        ...(code ? { code } : {}),
    };

    const params = Object.keys(paramKeys).reduce(
        (acc, name) => ({
            ...acc,
            [paramKeys[name]]: defaultParams[name],
        }),
        {}
    );

    const appendToUrl = "?" + new URLSearchParams(params).toString();

    const showLoading = status === GameStatus.loading;
    const showError = status === GameStatus.error;
    const showWaitingForHost = !isHost && status === GameStatus.waitingforhost;
    const showGameFrame = !isHost && status === GameStatus.inprogress;
    const showHostGameFrame =
        isHost &&
        (status === GameStatus.inprogress ||
            status === GameStatus.waitingforhost);

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
                    src={playerURL + appendToUrl}
                    key={frameRefreshCount}
                ></iframe>
            )}
            {showHostGameFrame && (
                <iframe
                    className="frame"
                    src={hostURL + appendToUrl}
                    key={frameRefreshCount}
                    onLoad={onHostGameLoaded}
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
