import { buildVietQrUrl } from './vietqr';

describe('buildVietQrUrl', () => {
  it('generates a valid, deterministic VietQR QuickLink URL using URLSearchParams', () => {
    const url = buildVietQrUrl({
      bin: '970436',
      accountNumber: '1234567890',
      amountVnd: 1500000,
      transferCode: 'BT-45',
      accountName: 'BREADTRANS TEST CENTER',
    });

    expect(url).toBe(
      'https://img.vietqr.io/image/970436-1234567890-compact2.png?amount=1500000&addInfo=BT-45&accountName=BREADTRANS+TEST+CENTER',
    );
  });
});
