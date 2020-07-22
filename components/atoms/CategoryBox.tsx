import { Button } from "@zeit-ui/react";
import { GameCategory } from "../../types/types";

const CategoryBox = ({
    category: { id, name, color, backgroundColor },
    onClick,
}: CategoryBoxProps): JSX.Element => (
    <>
        <Button
            shadow
            style={{
                color,
                backgroundColor,
                minWidth: "100%",
                width: "100%",
                height: "3.5em",
                padding: "0",
            }}
            onClick={() => onClick(id)}
            type="abort"
            size="large"
        >
            {name}
        </Button>
    </>
);

export type CategoryBoxProps = {
    category: GameCategory;
    onClick: (id: string) => void;
};

export default CategoryBox;
