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
    <div className="mt-4 mx-2 grid gap-3 grid-cols-2">
        {categories?.map((category, i) => (
            <div className="">
                <CategoryBox
                    key={category.id}
                    category={category}
                    onClick={onSelectCategory}
                    count={i}
                />
            </div>
        ))}
        <Spacer y={1} />
        <ButtonGroup>
            <PrimaryButton onClick={onDone} size="medium">
                ↩️ Back to {backToLabel}
            </PrimaryButton>
        </ButtonGroup>
    </div>
);

type CategoryGroupProps = {
    categories: Array<GameCategory>;
    onSelectCategory: (id: string) => void;
    onDone: () => void;
    backToLabel: string;
};

export default CategoryGroup;
