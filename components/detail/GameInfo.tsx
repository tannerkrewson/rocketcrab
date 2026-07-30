import { ClientGame } from "../../types/types";
import SkinnyCard from "../common/SkinnyCard";

const GameInfo = ({ game }: GameInfoProps): JSX.Element => (
    <SkinnyCard>
        {game.basedOn && (
            <div className="py-1 leading-none">
                <span className="w-5 text-xs text-center inline-block">🎲</span>{" "}
                Based on{" "}
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
        <div className="py-1 leading-none">
            <span className="w-5 text-xs text-center inline-block">🧍</span>{" "}
            {game.basedOn ? (
                <span>
                    Adapted for{" "}
                    <span className="w-5 text-xs text-center inline-block">
                        🚀
                    </span>
                    <span className="w-5 text-xs text-center inline-block">
                        🦀
                    </span>{" "}
                    by
                </span>
            ) : (
                "by "
            )}{" "}
            {game.author}
        </div>
        <div className="py-1 leading-none">
            <span className="w-5 text-xs text-center inline-block">🔗</span>{" "}
            <a
                href={game.displayUrlHref}
                target="_blank"
                rel="noopener noreferrer"
            >
                {game.displayUrlText}
            </a>
        </div>
        {game.donationUrlHref && game.donationUrlText && (
            <div className="py-1 leading-none">
                <span className="w-5 text-xs text-center inline-block">💲</span>{" "}
                <a
                    href={game.donationUrlHref}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {game.donationUrlText}
                </a>
            </div>
        )}
        {game.basedOn?.bggId && (
            <div className="py-1 leading-none">
                <span className="w-5 text-xs text-center inline-block">📙</span>{" "}
                More information on{" "}
                <a
                    href={`https://boardgamegeek.com/boardgame/${game.basedOn.bggId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    BoardGameGeek
                </a>
            </div>
        )}
    </SkinnyCard>
);

type GameInfoProps = {
    game: ClientGame;
};

export default GameInfo;
