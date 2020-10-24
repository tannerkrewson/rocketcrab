import SkinnyCard from "../common/SkinnyCard";

const GameDescription = ({
    description,
}: GameDescriptionProps): JSX.Element => (
    <SkinnyCard>
        <div>
            {description.split("\n\n").map((str, i) => (
                <div style={{ marginBottom: "1em" }} key={i}>
                    {str}
                </div>
            ))}
        </div>
    </SkinnyCard>
);

type GameDescriptionProps = {
    description: string;
};

export default GameDescription;
