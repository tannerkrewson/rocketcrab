import { ClientGame } from "../../types/types";
import SkinnyCard from "../common/SkinnyCard";

const GameInfo = ({ game }: GameInfoProps): JSX.Element => (
    <SkinnyCard>
        {game.basedOn && (
            <div className="info">
                <span className="emoji">🎲</span> Based on{" "}
                {game.basedOn.link ? (
                    <a
                        href={game.basedOn.link}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {game.basedOn.game}
                    </a>
                ) : (
                    game.basedOn.game
                )}
                {game.basedOn.author && <span> by {game.basedOn.author}</span>}
            </div>
        )}
        <div className="info">
            <span className="emoji">🧍</span>{" "}
            {game.basedOn ? (
                <span>
                    Adapted for <span className="emoji">🚀</span>
                    <span className="emoji">🦀</span> by
                </span>
            ) : (
                "by "
            )}{" "}
            {game.author}
        </div>
        <div className="info">
            <span className="emoji">🔗</span>{" "}
            <a
                href={game.displayUrlHref}
                target="_blank"
                rel="noopener noreferrer"
            >
                {game.displayUrlText}
            </a>
        </div>
        {game.donationUrlHref && game.donationUrlText && (
            <div className="info">
                <span className="emoji">💲</span>{" "}
                <a
                    href={game.donationUrlHref}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {game.donationUrlText}
                </a>
            </div>
        )}
        {game.basedOn.bggId && (
            <div className="info">
                <span className="emoji">📙</span> More information on{" "}
                <a
                    href={`https://boardgamegeek.com/boardgame/${game.basedOn.bggId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    BoardGameGeek
                </a>
            </div>
        )}
        <style jsx>{`
            .info {
                line-height: 0.85em;
                padding: 0.4em 0;
            }
            .emoji {
                width: 1.5em;
                font-size: 0.8em;
                display: inline-block;
                text-align: center;
            }
            p {
                margin: 0;
            }
        `}</style>
    </SkinnyCard>
);

type GameInfoProps = {
    game: ClientGame;
};

export default GameInfo;
