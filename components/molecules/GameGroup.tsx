import { Grid, Spacer } from "@geist-ui/react";
import PrimaryButton from "../atoms/PrimaryButton";
import ButtonGroup from "./ButtonGroup";

const GameGroup = ({ games, onBack }: GameGroupProps): JSX.Element => (
    <Grid.Container gap={1}>
        {games}
        <Spacer y={1} />
        <ButtonGroup>
            <PrimaryButton onClick={onBack}>
                ↩️ Back to categories
            </PrimaryButton>
        </ButtonGroup>
    </Grid.Container>
);

type GameGroupProps = {
    games: Array<JSX.Element>;
    onBack: () => void;
};

export default GameGroup;
