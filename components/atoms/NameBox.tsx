import { Loading } from "@zeit-ui/react";

const NameBox = ({ name }) => (
    <>
        <div
            style={{
                border: "1px solid LightGrey",
                padding: ".5em",
                margin: 0,
                textAlign: "center",
            }}
        >
            {name ? name : <Loading />}
        </div>
    </>
);

export default NameBox;
