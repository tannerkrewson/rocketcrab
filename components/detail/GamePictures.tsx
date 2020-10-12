import { useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import FsLightbox from "fslightbox-react";
import SkinnyCard from "../common/SkinnyCard";

const GamePictures = ({ pictures }: GamePicturesProps): JSX.Element => {
    const [lightboxState, setLightboxState] = useState({
        toggler: false,
        sourceIndex: 0,
    });

    if (!pictures?.length) return null;

    return (
        pictures?.length && (
            <SkinnyCard>
                <Swiper spaceBetween={16} slidesPerView={2.5}>
                    {pictures.map((picture, i) => (
                        <SwiperSlide key={picture}>
                            <img
                                src={picture}
                                style={{
                                    boxShadow:
                                        "2px 2px 6px rgba(0, 0, 0, 0.12)",
                                    borderRadius: "5px",
                                    border: "1px solid #eaeaea",
                                }}
                                onClick={() =>
                                    setLightboxState({
                                        toggler: !lightboxState.toggler,
                                        sourceIndex: i,
                                    })
                                }
                            />
                        </SwiperSlide>
                    ))}
                </Swiper>
                <FsLightbox
                    toggler={lightboxState.toggler}
                    sources={pictures}
                    sourceIndex={lightboxState.sourceIndex}
                />
            </SkinnyCard>
        )
    );
};

type GamePicturesProps = {
    pictures?: Array<string>;
};

export default GamePictures;
