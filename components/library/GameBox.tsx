import { ClientGame } from "../../types/types";
import { Description, Grid, useTheme } from "@geist-ui/react";

const GameBox = ({ game, onClick, count = 0 }: GameBoxProps): JSX.Element => {
    const {
        palette: { background, accents_2 },
    } = useTheme();

    return (
        <Grid xs={24}>
            <button onClick={() => onClick(game.id)} className="game-box">
                <b>{game.name}</b>
                <Description
                    style={{ width: "fit-content" }}
                    title={"by " + game.author}
                    className="remove-text-transform"
                />
                <span className="back-emoji">➡️</span>
            </button>
            <style jsx>{`
                .game-box {
                    min-width: 100%;
                    line-height: normal;
                    padding: 8pt;
                    text-align: initial;
                    position: relative;
                    cursor: pointer;
                    margin-bottom: 0.3em;
                    background-color: ${background};
                    border: 1px solid ${accents_2};
                    border-radius: 5px;
                    transition: background-color 200ms ease 0ms,
                        box-shadow 200ms ease 0ms, border 200ms ease 0ms,
                        color 200ms ease 0ms;

                    animation-name: fadein;
                    animation-duration: 0.25s;
                    animation-timing-function: ease-in-out;
                    animation-delay: ${count * 0.05}s;
                    animation-fill-mode: both;
                }
                .game-box:hover {
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
                    transform: translate3d(0px, -1px, 0px);
                }
                .game-box.game-box:active {
                    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.12);
                    transform: none;
                }
                @keyframes fadein {
                    from {
                        opacity: 0;
                        visibility: hidden;
                        transform: translateX(10%);
                    }
                    to {
                        opacity: 1;
                        visibility: visible;
                        transform: translateX(0%);
                    }
                }
                .back-emoji {
                    position: absolute;
                    right: 0.5em;
                    top: 1.2em;
                }
            `}</style>
        </Grid>
    );
};

type GameBoxProps = {
    game: ClientGame;
    onClick: (name: string) => void;
    count: number;
};

export default GameBox;
