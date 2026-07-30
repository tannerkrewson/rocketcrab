import ReactMarkdown from "react-markdown";

const GameGuide = ({ guide, guideUrl }: GameGuideProps): JSX.Element => (
    <>
        {guideUrl && (
            <>
                <div className="info">
                    <span className="emoji">🔗</span>{" "}
                    <a
                        href={guideUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {guideUrl}
                    </a>
                </div>
                <iframe
                    src={guideUrl}
                    style={{
                        width: "100vw",
                        height: "75vh",
                        position: "relative",
                        left: `calc((100vw - min(24em, 100vw)) / -2 - 0.5em)`,
                    }}
                />
            </>
        )}
        {guide && <ReactMarkdown>{guide}</ReactMarkdown>}
    </>
);

type GameGuideProps = {
    guide?: string;
    guideUrl?: string;
};

export default GameGuide;
