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
                <div
                    onClick={onEditName}
                    className="absolute left-2 bottom-2 cursor-pointer"
                >
                    ✏️
                </div>
            )}
            {onKick && (
                <div
                    onClick={onKick}
                    className="absolute left-2 bottom-2 cursor-pointer"
                >
                    ❌
                </div>
            )}
            <div className="absolute text-right right-1 bottom-0.5 text-gray-400 text-xs italic">
                {label.join(", ")}
            </div>
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
