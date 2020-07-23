import { Grid } from "@zeit-ui/react";

const ButtonGroup = ({ children }: ButtonGroupProps): JSX.Element => (
    <Grid.Container gap={1} justify="center">
        {children.map((button, index) => (
            <Grid key={index}>{button}</Grid>
        ))}
    </Grid.Container>
);

type ButtonGroupProps = {
    children: JSX.Element[];
};

export default ButtonGroup;
