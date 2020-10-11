import CategoryBox from "../atoms/CategoryBox";
import { GameCategory } from "../../types/types";
import { Grid, Spacer } from "@geist-ui/react";

import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "./ButtonGroup";

const CategoryGroup = ({
    categories,
    onSelectCategory,
    onDone,
    backToLabel,
}: CategoryGroupProps): JSX.Element => (
    <>
        <Grid.Container gap={1}>
            {categories.map((category, i) => (
                <CategoryBox
                    key={category.id}
                    category={category}
                    onClick={onSelectCategory}
                    count={i}
                />
            ))}
        </Grid.Container>
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
