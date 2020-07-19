import { Card } from "@zeit-ui/react";
import { GameCategory } from "../../types/types";

const CategoryBox = ({
    category: { id, name, color, backgroundColor },
    onClick,
}: CategoryBoxProps): JSX.Element => (
    <>
        <Card
            shadow
            style={{ color, backgroundColor }}
            onClick={() => onClick(id)}
        >
            <Card.Body style={{ padding: "8pt" }}>{name}</Card.Body>
        </Card>
    </>
);

export type CategoryBoxProps = {
    category: GameCategory;
    onClick: (id: string) => void;
};

export default CategoryBox;
