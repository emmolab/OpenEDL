type Props = {
  brandingImageVersion: string | null;
};

export function BrandMark({ brandingImageVersion }: Props) {
  return (
    <div
      className={`brand-mark${brandingImageVersion ? " custom-brand-mark" : ""}`}
      style={
        brandingImageVersion
          ? {
              backgroundImage: `url("/api/branding/image?v=${encodeURIComponent(brandingImageVersion)}")`,
            }
          : undefined
      }
      aria-hidden="true"
    >
      {brandingImageVersion ? null : "OE"}
    </div>
  );
}
