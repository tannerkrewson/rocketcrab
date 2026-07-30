import CategoryBox from "./CategoryBox";
import { GameCategory } from "../../types/types";

import PrimaryButton from "../common/PrimaryButton";

const CategoryGroup = ({
    categories,
    onSelectCategory,
    onDone,
    backToLabel,
}: CategoryGroupProps): JSX.Element => (
    <>
        <div className="my-8 mx-2 grid gap-3 grid-cols-2">
            {categories?.map((category, i) => (
                <CategoryBox
                    key={category.id}
                    category={category}
                    onClick={onSelectCategory}
                    count={i}
                />
            ))}
        </div>
        <div className="h-4"></div>
        <PrimaryButton onClick={onDone} size="md">
            ↩️ Back to {backToLabel}
        </PrimaryButton>
    </>
);

type CategoryGroupProps = {
    categories: Array<GameCategory>;
    onSelectCategory: (id: string) => void;
    onDone: () => void;
    backToLabel: string;
};

export default CategoryGroup;
