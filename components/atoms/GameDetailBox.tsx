import { ClientGame, GameCategory } from "../../types/types";
import { Card, Badge, Description, Tabs, Spacer } from "@zeit-ui/react";
import PrimaryButton from "./PrimaryButton";

const GameDetailBox = ({
    game,
    allCategories,
    onSelectGame,
    readyToPlay,
    showOnlyHostMessage,
}: GameDetailBoxProps): JSX.Element => (
    <Card
        style={{
            border: "none",
        }}
    >
        <Card.Body
            style={{
                padding: "4pt",
                textAlign: "initial",
                position: "relative",
            }}
        >
            {readyToPlay && (
                <Description
                    style={{ margin: "0 auto", width: "fit-content" }}
                    title="Waiting for the host to start..."
                />
            )}
            <h3
                style={{
                    textAlign: "center",
                }}
            >
                {game.name}
            </h3>
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
                    {game.basedOn.author && (
                        <span> by {game.basedOn.author}</span>
                    )}
                </div>
            )}
            <div className="info">
                <span className="emoji">🧍</span>{" "}
                {game.basedOn ? "Adapted for 🚀🦀 by " : "by "} {game.author}
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
            <GameBadges game={game} allCategories={allCategories} />
            <Spacer y={1} />
            <Tabs initialValue="1">
                <Tabs.Item label="Info" value="1">
                    <p>{game.description}</p>
                </Tabs.Item>
                <Tabs.Item label="Guide" value="2">
                    TODO: Similar games coming soon...
                </Tabs.Item>
                <Tabs.Item label="Pics" value="3">
                    TODO: Screenshots coming soon...
                </Tabs.Item>
            </Tabs>
            {onSelectGame && (
                <PrimaryButton onClick={() => onSelectGame(game.id)}>
                    Select game
                </PrimaryButton>
            )}
            {showOnlyHostMessage && (
                <Description
                    style={{ margin: "0 auto", width: "fit-content" }}
                    title="Only the host can select a game."
                />
            )}
        </Card.Body>
        <style jsx>{`
            .info {
                line-height: 0.85em;
                padding-bottom: 0.8em;
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
    </Card>
);

const GameBadges = ({
    game,
    allCategories,
}: GameDetailBoxProps): JSX.Element => (
    <div style={{ margin: ".5em 0" }}>
        {game.category.map((categoryId) => {
            const category = allCategories.find(({ id }) => id === categoryId);
            return (
                <SpaceBadge
                    key={categoryId}
                    style={{
                        color: category.color,
                        backgroundColor: category.backgroundColor,
                    }}
                >
                    {category.name}
                </SpaceBadge>
            );
        })}
        <SpaceBadge>{game.players} players</SpaceBadge>
        <SpaceBadge>
            {game.familyFriendly ? "Family friendly" : "Adults only"}
        </SpaceBadge>
    </div>
);

const SpaceBadge = ({ children, style = {} }) => (
    <span style={{ margin: ".1em" }}>
        <Badge style={style}>{children}</Badge>
    </span>
);

type GameDetailBoxProps = {
    game: ClientGame;
    allCategories: Array<GameCategory>;
    onSelectGame?: (id: string) => void;
    readyToPlay?: boolean;
    showOnlyHostMessage?: boolean;
};

export default GameDetailBox;
