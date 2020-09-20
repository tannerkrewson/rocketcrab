import { ClientGame, GameCategory } from "../../types/types";
import { Card, Badge, Description, Tabs } from "@geist-ui/react";
import PrimaryButton from "./PrimaryButton";

const GameDetailBox = ({
    game,
    allCategories,
    onSelectGame,
    showOnlyHostMessage,
}: GameDetailBoxProps): JSX.Element => (
    <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: "1.75em", fontWeight: "bold" }}>
            {game.name}
        </div>
        <Tabs initialValue="1">
            <Tabs.Item label="Info" value="1">
                <SkinnyCard>
                    <GameInfo game={game} />
                </SkinnyCard>
                <SkinnyCard>
                    <GameBadges game={game} allCategories={allCategories} />
                </SkinnyCard>
                <SkinnyCard>
                    <p>{game.description}</p>
                </SkinnyCard>
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
        <style jsx>{`
            p {
                margin: 0;
            }
        `}</style>
    </div>
);

const GameInfo = ({ game }): JSX.Element => (
    <>
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
    </>
);

const GameBadges = ({
    game,
    allCategories,
}: GameDetailBoxProps): JSX.Element => (
    <div>
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

const SkinnyCard = ({ children }) => (
    <Card style={{ marginBottom: "8pt" }}>
        <Card.Body style={{ padding: "8pt" }}>{children}</Card.Body>
    </Card>
);

type GameDetailBoxProps = {
    game: ClientGame;
    allCategories: Array<GameCategory>;
    onSelectGame?: (id: string) => void;
    showOnlyHostMessage?: boolean;
};

export default GameDetailBox;
