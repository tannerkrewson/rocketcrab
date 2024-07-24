const ButtonGroup = ({ children }: ButtonGroupProps): JSX.Element => {
    const buttons = Array.isArray(children) ? children : [children];
    return (
        <>
            {buttons.map((button) => (
                <>{button}</>
            ))}
        </>
    );
};

type ButtonGroupProps = {
    children: React.ReactNode;
};

export default ButtonGroup;
