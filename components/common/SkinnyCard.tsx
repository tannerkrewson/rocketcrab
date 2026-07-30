import { Card } from "@heroui/react";

const SkinnyCard = ({ children }: SkinnyCardProps): JSX.Element => {
    return (
        <Card>
            <Card.Content style={{ padding: "8pt" }}>{children}</Card.Content>
        </Card>
    );
};

type SkinnyCardProps = {
    children: React.ReactNode;
};

export default SkinnyCard;
