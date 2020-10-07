import CategoryBox from "../atoms/CategoryBox";
import { GameCategory } from "../../types/types";
import { Grid } from "@geist-ui/react";

const CategoryGroup = ({
    categories,
    onSelectCategory,
}: CategoryGroupProps): JSX.Element => (
    <Grid.Container gap={1}>
        {categories.map((category, i) => (
            <Grid xs={12} key={category.id}>
                <div className="anim-box">
                    <CategoryBox
                        category={category}
                        onClick={onSelectCategory}
                    />
                </div>
                <style jsx>{`
                    .anim-box {
                        animation-name: fadein;
                        animation-duration: 0.25s;
                        animation-timing-function: ease-in-out;
                        animation-delay: ${i * 0.05}s;
                        animation-fill-mode: both;
                    }
                    @keyframes fadein {
                        from {
                            opacity: 0;
                            visibility: hidden;
                            transform: scale(0.8);
                        }
                        to {
                            opacity: 1;
                            visibility: visible;
                            transform: scale(1);
                        }
                    }
                `}</style>
            </Grid>
        ))}
    </Grid.Container>
);

type CategoryGroupProps = {
    categories: Array<GameCategory>;
    onSelectCategory: (id: string) => void;
};

export default CategoryGroup;
