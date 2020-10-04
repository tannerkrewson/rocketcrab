import { ClientGame } from "../../types/types";
import { Description } from "@geist-ui/react";

const GameBox = ({ game, onClick }: GameBoxProps): JSX.Element => (
    <button onClick={() => onClick(game.id)} className="shadow-button">
        <b>{game.name}</b>
        <Description
            style={{ width: "fit-content" }}
            title={"by " + game.author}
            className="remove-text-transform"
        />
        {onClick && (
            <span
                style={{
                    position: "absolute",
                    right: ".5em",
                    top: "1.2em",
                }}
            >
                ➡️
            </span>
        )}
        <style jsx>{`
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
        `}</style>
    </button>
);

type GameBoxProps = {
    game: ClientGame;
    onClick: (name: string) => void;
};

export default GameBox;
