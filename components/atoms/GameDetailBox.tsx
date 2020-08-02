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
            border: "1pt solid LightGrey",
            borderRadius: "0",
        }}
    >
        <Card.Body
            style={{
                padding: "8pt",
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
            <div style={{ fontSize: "1.2em", fontWeight: "bold" }}>
                {game.name}
            </div>
            <div>
                <span className="emoji">🧍</span> by {game.author}
            </div>
            <div>
                <span className="emoji">🔗</span>{" "}
                <a
                    href={game.displayUrlHref}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {game.displayUrlText}
                </a>
            </div>
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
                <PrimaryButton onClick={() => onSelectGame(game.name)}>
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
    onSelectGame?: (name: string) => void;
    readyToPlay?: boolean;
    showOnlyHostMessage?: boolean;
};

export default GameDetailBox;
