import { Spinner, Card } from "@heroui/react";
import classNames from "classnames";

const NameBox = ({
    name,
    isHost,
    label = [],
    onEditName,
    onKick,
}: NameBoxProps): JSX.Element => (
    <Card
        className={classNames("rounded-sm shadow-sm", {
            "border-1 border-rose-400": isHost,
        })}
    >
        <div className="text-center p-3">
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
        </div>
    </Card>
);

type NameBoxProps = {
    name?: string;
    isHost?: boolean;
    label?: string[];
    onEditName?: () => void;
    onKick?: () => void;
};

export default NameBox;
