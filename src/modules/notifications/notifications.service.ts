/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscribeDto, SendPushPayload } from './dto/push-subscription.dto';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const isProd = process.env.NODE_ENV === 'production';
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@breadtrans.com';

    if (!publicKey || !privateKey) {
      if (isProd) {
        throw new Error(
          '[Security] VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are mandatory in production environment.',
        );
      }
      this.logger.warn(
        '[NotificationsService] VAPID keys not configured in non-production. Web push notifications disabled.',
      );
      return;
    }

    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.logger.log('VAPID details successfully configured for Web Push.');
    } catch (err) {
      if (isProd) {
        throw new Error(
          `[Security] Invalid VAPID configuration in production: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.logger.error('Failed to configure VAPID details:', err);
    }
  }

  async subscribe(userId: number, dto: SubscribeDto) {
    try {
      const sub = await (this.prisma as any).pushSubscription.upsert({
        where: { endpoint: dto.endpoint },
        update: {
          userId,
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
          userAgent: dto.userAgent || null,
        },
        create: {
          userId,
          endpoint: dto.endpoint,
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
          userAgent: dto.userAgent || null,
        },
      });

      this.logger.log(
        `User #${userId} subscribed to push notifications (ID: ${sub.id}).`,
      );
      return { success: true, message: 'Đăng ký nhận thông báo thành công!' };
    } catch (err) {
      this.logger.error(`Error subscribing user #${userId}:`, err);
      throw err;
    }
  }

  async unsubscribe(endpoint: string, userId: number) {
    try {
      const deleteResult = await (this.prisma as any).pushSubscription.deleteMany({
        where: { endpoint, userId },
      });
      this.logger.log(
        `Unsubscribed push endpoint (${deleteResult.count} removed): ${endpoint.substring(0, 30)}...`,
      );
      return { success: true, message: 'Đã hủy đăng ký nhận thông báo.' };
    } catch (err) {
      this.logger.error('Error unsubscribing push endpoint:', err);
      throw err;
    }
  }

  async sendPushToUser(userId: number, payload: SendPushPayload) {
    try {
      const subscriptions = await (
        this.prisma as any
      ).pushSubscription.findMany({
        where: { userId },
      });

      if (!subscriptions || subscriptions.length === 0) {
        this.logger.debug(
          `User #${userId} has no registered push subscriptions.`,
        );
        return { sent: 0, failed: 0 };
      }

      let sentCount = 0;
      let failedCount = 0;

      const formattedPayload = JSON.stringify({
        title: payload.title || 'BreadTrans Thông Báo',
        body: payload.body || '',
        icon: payload.icon || '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        url: payload.url || '/',
        data: {
          url: payload.url || '/',
          ...(payload.data || {}),
        },
      });

      for (const sub of subscriptions) {
        const pushSubscriptionObject = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(
            pushSubscriptionObject,
            formattedPayload,
          );
          sentCount++;
        } catch (err: any) {
          failedCount++;
          // Handle 410 Gone / 404 Not Found (expired / uninstalled)
          if (err.statusCode === 410 || err.statusCode === 404) {
            this.logger.warn(
              `Subscription ${sub.id} expired or uninstalled (${err.statusCode}). Cleaning up from DB.`,
            );
            await (this.prisma as any).pushSubscription.delete({
              where: { id: sub.id },
            });
          } else {
            this.logger.error(
              `Failed to send push notification to sub ${sub.id}:`,
              err.message || err,
            );
          }
        }
      }

      this.logger.log(
        `Push sent to user #${userId}: ${sentCount} succeeded, ${failedCount} failed.`,
      );
      return { sent: sentCount, failed: failedCount };
    } catch (err) {
      this.logger.error(`Error sending push to user #${userId}:`, err);
      return { sent: 0, failed: 0 };
    }
  }

  async sendPushToMultipleUsers(userIds: number[], payload: SendPushPayload) {
    const results = await Promise.allSettled(
      userIds.map((uid) => this.sendPushToUser(uid, payload)),
    );
    return results;
  }
}
