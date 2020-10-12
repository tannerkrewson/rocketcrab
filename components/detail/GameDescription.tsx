import SkinnyCard from "../common/SkinnyCard";

const GameDescription = ({
    description,
}: GameDescriptionProps): JSX.Element => (
    <SkinnyCard>
        <div>{description}</div>
    </SkinnyCard>
);

type GameDescriptionProps = {
    description: string;
};

export default GameDescription;
