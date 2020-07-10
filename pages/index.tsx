import PrimaryButton from "../components/PrimaryButton";
import ButtonGroup from "../components/ButtonGroup";
import PageLayout from "../components/PageLayout";

export const Home = (): JSX.Element => (
    <PageLayout>
        <div className="description">all the best mobile web party games</div>

        <ButtonGroup>
            <PrimaryButton href="/join">Join Lobby</PrimaryButton>

            <PrimaryButton href="/new">New Lobby</PrimaryButton>
        </ButtonGroup>
        <style jsx>{`
            .description {
                text-align: center;
                margin-bottom: 2em;
            }
        `}</style>
    </PageLayout>
);

export default Home;
