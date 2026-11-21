import { renderEmail } from './email-layout';

/**
 * Account emails (owner 2026-11-21: every email gets one tone and one layout).
 * Pure: the caller sends `subject` and `html`. Subjects carry no "BreadTrans -"
 * prefix; the sender name already says BreadTrans.
 */
export type RenderedEmail = { subject: string; html: string };

const SIGN_OFF = ['Trân trọng,', 'Đội ngũ BreadTrans'];
const AUTOMATIC = 'Đây là email tự động, vui lòng không trả lời.';
const appBase = (appUrl: string) => appUrl.replace(/\/+$/, '');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const two = (n: number) => String(n).padStart(2, '0');
const vnLocal = (date: Date) => new Date(date.getTime() + VN_OFFSET_MS);
/** "22/11/2026" in Vietnam time. */
export function vnDate(date: Date): string {
  const local = vnLocal(date);
  return `${two(local.getUTCDate())}/${two(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
}
/** "20:06 ngày 22/11/2026" in Vietnam time. */
export function vnClock(date: Date): string {
  const local = vnLocal(date);
  return `${two(local.getUTCHours())}:${two(local.getUTCMinutes())} ngày ${vnDate(date)}`;
}

export function passwordResetEmail(resetUrl: string): RenderedEmail {
  return {
    subject: 'Đặt lại mật khẩu tài khoản BreadTrans',
    html: renderEmail({
      preheader: 'Liên kết đặt lại mật khẩu có hiệu lực trong 15 phút.',
      greeting: 'Chào bạn,',
      paragraphs: [
        'BreadTrans vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản dùng địa chỉ email này.',
        'Bấm nút bên dưới để đặt mật khẩu mới. Liên kết có hiệu lực trong 15 phút và chỉ dùng được một lần.',
      ],
      action: { label: 'Đặt lại mật khẩu', url: resetUrl },
      signOff: SIGN_OFF,
      footer: `Nếu bạn không gửi yêu cầu này, hãy bỏ qua email; mật khẩu hiện tại vẫn giữ nguyên. ${AUTOMATIC}`,
    }),
  };
}

export function registrationOtpEmail(otp: string): RenderedEmail {
  return {
    subject: 'Mã xác thực đăng ký BreadTrans',
    html: renderEmail({
      preheader: `Mã xác thực của bạn là ${otp}, có hiệu lực trong 5 phút.`,
      greeting: 'Chào bạn,',
      paragraphs: [
        'Đây là mã xác thực để hoàn tất đăng ký tài khoản BreadTrans:',
        { code: otp },
        'Mã có hiệu lực trong 5 phút. Vì lý do bảo mật, đừng chia sẻ mã này với bất kỳ ai.',
      ],
      signOff: SIGN_OFF,
      footer: `Nếu bạn không đăng ký BreadTrans, hãy bỏ qua email này. ${AUTOMATIC}`,
    }),
  };
}

export function accountDeletionEmail(input: {
  accountEmail: string;
  /** The deletion day, already in Vietnam format (dd/mm/yyyy). */
  day: string;
  appUrl: string;
}): RenderedEmail {
  return {
    subject: 'Yêu cầu xoá tài khoản BreadTrans đã được ghi nhận',
    html: renderEmail({
      preheader: `Tài khoản sẽ bị xoá vĩnh viễn vào ngày ${input.day}. Đăng nhập trước ngày này để huỷ.`,
      greeting: 'Chào bạn,',
      paragraphs: [
        `BreadTrans đã nhận được yêu cầu xoá tài khoản dùng địa chỉ ${input.accountEmail}.`,
        `Tài khoản cùng dữ liệu học tập sẽ bị xoá vĩnh viễn vào ngày ${input.day}. Lịch sử đơn hàng và thanh toán được giữ lại ở dạng ẩn danh để phục vụ đối soát.`,
        'Nếu bạn đổi ý, hãy đăng nhập lại trước ngày trên và chọn "Huỷ yêu cầu xoá". Sau ngày đó, tài khoản không thể khôi phục.',
      ],
      action: {
        label: 'Đăng nhập để huỷ yêu cầu',
        url: `${appBase(input.appUrl)}/login`,
      },
      signOff: SIGN_OFF,
      footer: `Nếu bạn không gửi yêu cầu này, hãy đăng nhập ngay để huỷ và đổi mật khẩu. ${AUTOMATIC}`,
    }),
  };
}

/**
 * Security notice after a password change (owner 2026-11-21): the owner of the
 * mailbox learns of a change they did not make. A reset signs every device
 * out; a change from the account page keeps the device that made it.
 */
export function passwordChangedEmail(input: {
  changedAt: Date;
  signedOut: 'all' | 'others';
  appUrl: string;
}): RenderedEmail {
  const when = vnClock(input.changedAt);
  const devices =
    input.signedOut === 'all'
      ? 'Để an toàn, tài khoản đã được đăng xuất trên mọi thiết bị. Hãy đăng nhập lại bằng mật khẩu mới.'
      : 'Để an toàn, tài khoản đã được đăng xuất trên các thiết bị khác. Thiết bị vừa đổi mật khẩu vẫn đăng nhập như cũ.';
  return {
    subject: 'Mật khẩu tài khoản BreadTrans vừa được đổi',
    html: renderEmail({
      preheader: `Mật khẩu đã được đổi lúc ${when}.`,
      greeting: 'Chào bạn,',
      paragraphs: [
        `Mật khẩu của tài khoản BreadTrans dùng địa chỉ email này vừa được đổi lúc ${when}.`,
        devices,
        'Nếu không phải bạn đổi mật khẩu, hãy đặt lại mật khẩu ngay bằng nút bên dưới.',
      ],
      action: {
        label: 'Đặt lại mật khẩu',
        url: `${appBase(input.appUrl)}/forgot-password`,
      },
      signOff: SIGN_OFF,
      footer: `Nếu bạn vừa đổi mật khẩu, không cần làm gì thêm. ${AUTOMATIC}`,
    }),
  };
}

/** The account was purged as its owner asked (owner 2026-11-21). */
export function accountDeletedEmail(input: {
  accountEmail: string;
  deletedAt: Date;
}): RenderedEmail {
  const day = vnDate(input.deletedAt);
  return {
    subject: 'Tài khoản BreadTrans đã được xoá',
    html: renderEmail({
      preheader: `Tài khoản đã được xoá vĩnh viễn ngày ${day}.`,
      greeting: 'Chào bạn,',
      paragraphs: [
        `Theo yêu cầu của bạn, tài khoản BreadTrans dùng địa chỉ ${input.accountEmail} đã được xoá vĩnh viễn ngày ${day}.`,
        'Hồ sơ, bài làm, ghi âm và tiến độ học đã bị xoá. Lịch sử đơn hàng và thanh toán được giữ lại ở dạng ẩn danh để phục vụ đối soát, không còn gắn với email này.',
        'Nếu muốn học tiếp, bạn có thể đăng ký tài khoản mới bằng email này bất cứ lúc nào.',
      ],
      signOff: SIGN_OFF,
      footer: AUTOMATIC,
    }),
  };
}
