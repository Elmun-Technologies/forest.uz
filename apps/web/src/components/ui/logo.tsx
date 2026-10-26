import Image, { type StaticImageData } from 'next/image';

/**
 * Partner/brand logo sized by CSS height (`className="h-5"`). Width follows the aspect ratio;
 * `width: auto` is declared so next/image doesn't warn about a one-sided resize.
 */
export function Logo({
  src,
  alt,
  className,
}: {
  src: StaticImageData;
  alt: string;
  className: string;
}) {
  return (
    <Image src={src} alt={alt} className={className} style={{ width: 'auto' }} sizes="200px" />
  );
}
