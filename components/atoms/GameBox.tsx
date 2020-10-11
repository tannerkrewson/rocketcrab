import { ClientGame } from "../../types/types";
import { Description, Grid } from "@geist-ui/react";

const GameBox = ({ game, onClick, count = 0 }: GameBoxProps): JSX.Element => (
    <Grid xs={24}>
        <div className="anim-box">
            <button onClick={() => onClick(game.id)} className="shadow-button">
                <b>{game.name}</b>
                <Description
                    style={{ width: "fit-content" }}
                    title={"by " + game.author}
                    className="remove-text-transform"
                />
                <span className="back-emoji">➡️</span>
            </button>
        </div>
        <style jsx>{`
            .anim-box {
                animation-name: fadein;
                animation-duration: 0.25s;
                animation-timing-function: ease-in-out;
                animation-delay: ${count * 0.05}s;
                animation-fill-mode: both;
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
            .shadow-button {
                min-width: 100%;
                line-height: normal;
                padding: 8pt;
                text-align: initial;
                position: relative;
                cursor: pointer;
                margin-bottom: 0.3em;
                background-color: white;
                border: 1px solid #ddd;
                border-radius: 5px;
                transition: background-color 200ms ease 0ms,
                    box-shadow 200ms ease 0ms, border 200ms ease 0ms,
                    color 200ms ease 0ms;
            }
            .shadow-button:hover {
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
                transform: translate3d(0px, -1px, 0px);
            }
            .shadow-button.shadow-button:active {
                box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.12);
                transform: none;
            }

            .back-emoji {
                position: absolute;
                right: 0.5em;
                top: 1.2em;
            }
        `}</style>
    </Grid>
);

type GameBoxProps = {
    game: ClientGame;
    onClick: (name: string) => void;
    count: number;
};

export default GameBox;
