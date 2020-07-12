import { Select } from "@zeit-ui/react";

const GameSelector = ({ gameList }) => (
    <Select placeholder="Select a game">
        {gameList.map(({ name }, i) => (
            <Select.Option key={i} value={name}>
                {name}
            </Select.Option>
        ))}
    </Select>
);

export default GameSelector;
