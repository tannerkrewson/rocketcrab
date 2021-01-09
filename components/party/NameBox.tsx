import { Loading, Card } from "@geist-ui/react";

const NameBox = ({
    name,
    color,
    label = [],
    onEditName,
    onKick,
}: NameBoxProps): JSX.Element => (
    <Card
        style={{
            border: "1pt solid " + (color || "#ddd"),
            borderRadius: "0",
            boxShadow: "none",
        }}
    >
        <Card.Body style={{ padding: ".5em", position: "relative" }}>
            {name ? name : <Loading />}
            {onEditName && (
                <div onClick={onEditName} className="emoji-button">
                    ✏️
                </div>
            )}
            {onKick && (
                <div onClick={onKick} className="emoji-button">
                    ❌
                </div>
            )}
            <div className="labels">{label.join(", ")}</div>
            <style jsx>{`
                .emoji-button {
                    cursor: pointer;
                    position: absolute;
                    left: 0.5em;
                    bottom: 0.5em;
                }
                .labels {
                    position: absolute;
                    text-align: right;
                    right: 0.3em;
                    bottom: 0;
                    color: Grey;
                    font-size: 0.8em;
                    font-style: italic;
                }
            `}</style>
        </Card.Body>
    </Card>
);

type NameBoxProps = {
    name?: string;
    color?: string;
    label?: string[];
    onEditName?: () => void;
    onKick?: () => void;
};

export default NameBox;
