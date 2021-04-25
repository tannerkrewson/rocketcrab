import { Card, useTheme } from "@geist-ui/react";

const SkinnyCard = ({ children }: SkinnyCardProps): JSX.Element => {
    const {
        palette: { accents_1 },
    } = useTheme();

    return (
        <Card
            style={{
                marginBottom: "12pt",
                backgroundColor: accents_1,
            }}
        >
            <Card.Body style={{ padding: "8pt" }}>{children}</Card.Body>
        </Card>
    );
};

type SkinnyCardProps = {
    children: React.ReactNode;
};

export default SkinnyCard;
