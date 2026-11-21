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
