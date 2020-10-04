import { Button } from "@geist-ui/react";
import { GameCategory } from "../../types/types";

const CategoryBox = ({
    category: { id, name, color, backgroundColor },
    onClick,
}: CategoryBoxProps): JSX.Element => (
    <Button
        shadow
        style={{
            color,
            backgroundColor,
            minWidth: "100%",
            width: "100%",
            minHeight: "3.5em",
            padding: "0",
            whiteSpace: "normal",
            lineHeight: "normal",
        }}
        onClick={() => onClick(id)}
        type="abort"
        size="large"
    >
        {name}
    </Button>
);

export type CategoryBoxProps = {
    category: GameCategory;
    onClick: (id: string) => void;
};

export default CategoryBox;
