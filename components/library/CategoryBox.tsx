import { GameCategory } from "../../types/types";

const CategoryBox = ({
    category: { id, name, color, backgroundColor },
    onClick,
    count,
}: CategoryBoxProps): JSX.Element => (
    <>
        <style>{`@keyframes category-fadein { from { opacity: 0; visibility: hidden; transform: scale(0.8); } to { opacity: 1; visibility: visible; transform: scale(1); } }`}</style>
        <button
            onClick={() => onClick(id)}
            style={{
                overflow: "hidden",
                border: "none",
                width: "100%",
                minHeight: "3.5em",
                padding: 0,
                lineHeight: "normal",
                cursor: "pointer",
                marginBottom: "0.3em",
                color,
                backgroundColor,
                boxShadow: `${backgroundColor} 0px 1px 8px 0px`,
                transition:
                    "transform 200ms ease 0ms, box-shadow 200ms ease 0ms",
                animation: `category-fadein 0.25s ease-in-out ${count * 0.05}s both`,
            }}
            className="rounded-lg"
            onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `${backgroundColor} 0 4px 12px`;
                e.currentTarget.style.transform = "translate3d(0px, -1px, 0px)";
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = `${backgroundColor} 0px 1px 8px 0px`;
                e.currentTarget.style.transform = "translate3d(0, 0, 0)";
            }}
        >
            {name}
        </button>
    </>
);

export type CategoryBoxProps = {
    category: GameCategory;
    onClick: (id: string) => void;
    count: number;
};

export default CategoryBox;
