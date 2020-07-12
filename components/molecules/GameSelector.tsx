import { Select } from "@zeit-ui/react";

const GameSelector = ({ gameList, onGameSelect, selectedGame }) => (
    <Select
        placeholder="Select a game"
        onChange={onGameSelect}
        initialValue={selectedGame}
        value={selectedGame}
    >
        {gameList.map(({ name }, i) => (
            <Select.Option key={i} value={name}>
                {name}
            </Select.Option>
        ))}
    </Select>
);

export default GameSelector;
