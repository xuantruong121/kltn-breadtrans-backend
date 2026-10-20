import {
  assertValidContentImageUpload,
  isAcceptedContentImageReference,
  isValidContentImageUpload,
} from './content-image-validation';

const png = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0,
]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const webp = Buffer.from('RIFF____WEBP', 'ascii');
const r2Png =
  'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/content/image.png';

describe('content image validation', () => {
  it.each([
    ['image/png', png],
    ['image/jpeg', jpeg],
    ['image/webp', webp],
  ])('accepts valid %s raster signatures', (mimeType, buffer) => {
    expect(isValidContentImageUpload(buffer, mimeType)).toBe(true);
  });

  it('rejects SVG MIME and disguised SVG payloads', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(isValidContentImageUpload(svg, 'image/svg+xml')).toBe(false);
    expect(isValidContentImageUpload(svg, 'image/png')).toBe(false);
    expect(() =>
      assertValidContentImageUpload({
        mimetype: 'image/svg+xml',
        buffer: svg,
      } as Express.Multer.File),
    ).toThrow('PNG, JPEG hoặc WEBP');
  });

  it('accepts only trusted raster URLs for publish readiness', () => {
    expect(isAcceptedContentImageReference(r2Png)).toBe(true);
    expect(isAcceptedContentImageReference('data:image/svg+xml,<svg/>')).toBe(
      false,
    );
    expect(
      isAcceptedContentImageReference('https://cdn.example/picture.svg'),
    ).toBe(false);
    expect(
      isAcceptedContentImageReference('https://cdn.example/picture.png'),
    ).toBe(false);
    expect(isAcceptedContentImageReference(null)).toBe(false);
  });
});
