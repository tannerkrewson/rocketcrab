import { GameCategory } from "../../types/types";

const CategoryBox = ({
    category: { id, name, color, backgroundColor },
    onClick,
}: CategoryBoxProps): JSX.Element => (
    <button onClick={() => onClick(id)} className="category-box">
        {name}
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
            }
            .category-box:hover {
                box-shadow: ${backgroundColor} 0 4px 12px;
                transform: translate3d(0px, -1px, 0px);
            }
        `}</style>
    </button>
);

export type CategoryBoxProps = {
    category: GameCategory;
    onClick: (id: string) => void;
};

export default CategoryBox;
