import CategoryBox from "./CategoryBox";
import { GameCategory } from "../../types/types";
import { Spacer } from "@nextui-org/react";

import PrimaryButton from "../common/PrimaryButton";
import ButtonGroup from "../common/ButtonGroup";

const CategoryGroup = ({
    categories,
    onSelectCategory,
    onDone,
    backToLabel,
}: CategoryGroupProps): JSX.Element => (
    <>
        {categories?.map((category, i) => (
            <CategoryBox
                key={category.id}
                category={category}
                onClick={onSelectCategory}
                count={i}
            />
        ))}
        <Spacer y={1} />
        <ButtonGroup>
            <PrimaryButton onClick={onDone} size="medium">
                ↩️ Back to {backToLabel}
            </PrimaryButton>
        </ButtonGroup>
    </>
);

type CategoryGroupProps = {
    categories: Array<GameCategory>;
    onSelectCategory: (id: string) => void;
    onDone: () => void;
    backToLabel: string;
};

export default CategoryGroup;
