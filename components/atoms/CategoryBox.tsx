import { GameCategory } from "../../types/types";
import { Grid } from "@geist-ui/react";
const CategoryBox = ({
    category: { id, name, color, backgroundColor },
    onClick,
    count,
}: CategoryBoxProps): JSX.Element => (
    <Grid xs={12} key={id}>
        <button onClick={() => onClick(id)} className="category-box">
            {name}
        </button>
        <style jsx>{`
            .category-box {
                overflow: hidden;
                border: none;
                border-radius: 5px;
                width: 100%;
                min-height: 3.5em;
                padding: 0px;
                line-height: normal;
                cursor: pointer;
                margin-bottom: 0.3em;
                color: ${color};
                background-color: ${backgroundColor};
                box-shadow: ${backgroundColor} 0px 1px 8px 0px;
                transition: transform 200ms ease 0ms, box-shadow 200ms ease 0ms;

                animation-name: fadein;
                animation-duration: 0.25s;
                animation-timing-function: ease-in-out;
                animation-delay: ${count * 0.05}s;
                animation-fill-mode: both;
            }
            .category-box:hover {
                box-shadow: ${backgroundColor} 0 4px 12px;
                transform: translate3d(0px, -1px, 0px);
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
);

export type CategoryBoxProps = {
    category: GameCategory;
    onClick: (id: string) => void;
    count: number;
};

export default CategoryBox;
