/**
 * VietQR QuickLink image for a manual bank transfer. Used by plan purchases
 * (PLUS/PRO); it moved here when the classroom tuition PaymentService was
 * retired.
 */
export function buildVietQrUrl(params: {
  bin: string;
  accountNumber: string;
  amountVnd: number;
  transferCode: string;
  accountName: string;
}): string {
  const url = new URL(
    `https://img.vietqr.io/image/${params.bin}-${params.accountNumber}-compact2.png`,
  );
  url.searchParams.set('amount', params.amountVnd.toString());
  url.searchParams.set('addInfo', params.transferCode);
  url.searchParams.set('accountName', params.accountName);
  return url.toString();
}
