import { Grid } from "@geist-ui/react";

const ButtonGroup = ({ children }: ButtonGroupProps): JSX.Element => {
    const buttons = Array.isArray(children) ? children : [children];
    return (
        <Grid.Container gap={1} justify="center">
            {buttons.map((button, index) => (
                <Grid key={index}>{button}</Grid>
            ))}
        </Grid.Container>
    );
};

type ButtonGroupProps = {
    children: JSX.Element[] | JSX.Element;
};

export default ButtonGroup;
