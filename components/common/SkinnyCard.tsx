import { Card, CardBody } from "@heroui/react";

const SkinnyCard = ({ children }: SkinnyCardProps): JSX.Element => {
    return (
        <Card>
            <CardBody style={{ padding: "8pt" }}>{children}</CardBody>
        </Card>
    );
};

type SkinnyCardProps = {
    children: React.ReactNode;
};

export default SkinnyCard;
