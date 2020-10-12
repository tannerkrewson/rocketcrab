import { Card } from "@geist-ui/react";

const SkinnyCard = ({ children }: SkinnyCardProps): JSX.Element => (
    <Card style={{ marginBottom: "12pt" }}>
        <Card.Body style={{ padding: "8pt" }}>{children}</Card.Body>
    </Card>
);

type SkinnyCardProps = {
    children: React.ReactNode;
};

export default SkinnyCard;
