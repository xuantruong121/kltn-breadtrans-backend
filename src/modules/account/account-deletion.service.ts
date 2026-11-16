import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { forgetAuthUser } from '../auth/auth-user-cache';
import { AuthSessionStore } from '../auth/session-store';
import { cancelTokenKey, deletionScheduledAt } from './account-deletion.logic';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );

/**
 * "Xoá tài khoản" (owner 2026-11-16): the request locks the account and signs
 * out every device at once; AccountPurgeService deletes it when the grace
 * period ends. Signing in during the grace period hands out a cancel token.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private readonly sessions: AuthSessionStore;

  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
    private readonly email: EmailService,
  ) {
    this.sessions = new AuthSessionStore(redis);
  }

  /**
   * Schedules the deletion. A password account confirms with its password; an
   * account that only signs in with Google types its e-mail address.
   */
  async request(
    userId: number,
    confirm: { password?: string; confirmEmail?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        password: true,
        deletionScheduledAt: true,
        anonymizedAt: true,
      },
    });
    if (!user || user.anonymizedAt)
      throw new UnauthorizedException('Tài khoản không còn hợp lệ.');
    if (user.role === 'ADMIN')
      throw new BadRequestException(
        'Tài khoản quản trị không tự xoá được. Hãy nhờ một quản trị viên khác.',
      );
    if (user.password) {
      const ok =
        !!confirm.password &&
        (await bcrypt.compare(confirm.password, user.password));
      if (!ok) throw new UnauthorizedException('Mật khẩu không chính xác.');
    } else if (
      (confirm.confirmEmail ?? '').trim().toLowerCase() !== user.email
    ) {
      throw new BadRequestException(
        'Hãy gõ đúng địa chỉ email của tài khoản để xác nhận.',
      );
    }

    const now = new Date();
    const scheduledAt = user.deletionScheduledAt ?? deletionScheduledAt(now);
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: now, deletionScheduledAt: scheduledAt },
    });
    forgetAuthUser(userId);
    await this.sessions.revokeAll(userId);

    const day = scheduledAt.toLocaleDateString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    try {
      await this.email.sendAccountDeletionScheduled(
        user.email,
        `<p>Tài khoản BreadTrans <strong>${escapeHtml(user.email)}</strong> sẽ bị xoá vĩnh viễn vào ngày <strong>${day}</strong>.</p>` +
          '<p>Nếu đổi ý, hãy đăng nhập lại trước ngày đó và chọn "Huỷ yêu cầu xoá".</p>',
      );
    } catch (error) {
      this.logger.warn(
        `account_deletion_email_failed user=${userId}: ${String(error)}`,
      );
    }
    return { scheduledAt: scheduledAt.toISOString() };
  }

  /** Cancels a scheduled deletion with the token a valid sign-in returned. */
  async cancel(cancelToken: string) {
    const raw = await this.redis.getdel(cancelTokenKey(cancelToken));
    const userId = Number(raw);
    if (!raw || !Number.isInteger(userId))
      throw new UnauthorizedException(
        'Mã huỷ đã hết hạn. Hãy đăng nhập lại để huỷ yêu cầu xoá.',
      );
    const updated = await this.prisma.user.updateMany({
      where: {
        id: userId,
        anonymizedAt: null,
        deletionRequestedAt: { not: null },
      },
      data: { deletionRequestedAt: null, deletionScheduledAt: null },
    });
    forgetAuthUser(userId);
    if (updated.count === 0)
      throw new BadRequestException('Tài khoản không có yêu cầu xoá nào.');
    return { cancelled: true };
  }
}
