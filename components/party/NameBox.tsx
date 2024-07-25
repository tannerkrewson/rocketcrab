import { Spinner, Card, CardBody } from "@nextui-org/react";

const NameBox = ({
    name,
    color,
    label = [],
    onEditName,
    onKick,
}: NameBoxProps): JSX.Element => (
    <Card radius="sm" shadow="sm">
        <CardBody className="text-center">
            {name ? name : <Spinner />}
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
                    bottom: 0.1em;
                    color: Grey;
                    font-size: 0.8em;
                    font-style: italic;
                }
            `}</style>
        </CardBody>
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
