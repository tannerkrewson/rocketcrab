import { Grid } from "@zeit-ui/react";

const ButtonGroup = ({ children }) => (
    <Grid.Container gap={1} justify="center">
        {children.map((button, index) => (
            <Grid key={index}>{button}</Grid>
        ))}
    </Grid.Container>
);

export default ButtonGroup;
