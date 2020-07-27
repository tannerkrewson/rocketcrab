import { Loading, Card } from "@zeit-ui/react";

const NameBox = ({ name, onEditName }: NameBoxProps): JSX.Element => (
    <Card
        style={{
            border: "1pt solid LightGrey",
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
        </Card.Body>
    </Card>
);

type NameBoxProps = {
    name?: string;
    onEditName?: () => void;
};

export default NameBox;
