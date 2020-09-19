import { Loading, Card } from "@zeit-ui/react";

const NameBox = ({
    name,
    color,
    label = [],
    onEditName,
}: NameBoxProps): JSX.Element => (
    <Card
        style={{
            border: "1pt solid " + (color || "#ddd"),
            borderRadius: "0",
        }}
    >
        <Card.Body style={{ padding: ".5em", position: "relative" }}>
            {name ? name : <Loading />}
            {onEditName ? (
                <div
                    onClick={onEditName}
                    style={{
                        cursor: "pointer",
                        position: "absolute",
                        left: ".5em",
                        bottom: ".5em",
                    }}
                >
                    ✏️
                </div>
            ) : (
                false
            )}
            <div
                style={{
                    position: "absolute",
                    textAlign: "right",
                    right: ".3em",
                    bottom: "0",
                    color: "Grey",
                    fontSize: ".8em",
                    fontStyle: "italic",
                }}
            >
                {label.join(", ")}
            </div>
        </Card.Body>
    </Card>
);

type NameBoxProps = {
    name?: string;
    color?: string;
    label?: string[];
    onEditName?: () => void;
};

export default NameBox;
