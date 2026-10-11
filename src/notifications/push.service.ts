import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';

import { pushConfig } from '../config/configuration';
import { NotificationStatus, NotificationType } from '../common/enums/notification.enum';
import { invalidOperation } from '../common/errors/api-exception';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { RegisterPushSubscriptionDto } from './dto/push.dto';

/** The JSON handed to the service worker; every field is optional to the reader. */
export interface PushPayload {
  id: string;
  type: string;
  title: string;
  message: string | null;
  resourceType: string | null;
  resourceId: string | null;
  /** In-app route the tray notification opens. Always origin-relative. */
  url: string;
  /** Unread total after this notification — the home-screen icon badge. */
  badgeCount: number;
  createdAt: string;
}

/**
 * `resource_type` + `resource_id` (docs/03 §59) mapped to the screen that shows
 * the record. Mirrors RESOURCE_ROUTES in the web notification centre; anything
 * unmapped falls back to the notification list rather than a guessed URL.
 */
const RESOURCE_URLS: Record<string, (id: string) => string> = {
  DAILY_REPORT: (id) => `/daily-reports?report=${id}`,
  INCIDENT_REPORT: (id) => `/daily-reports?incident=${id}`,
  DELIVERY: (id) => `/deliveries?delivery=${id}`,
  FUEL_ORDER: () => '/fuel-orders',
  FUEL_PRICE: () => '/fuel-prices',
  SALE: () => '/sales',
  BRANCH: () => '/inventory',
};

const DEFAULT_URL = '/notifications';

type PushSettings = ReturnType<typeof pushConfig>;

/**
 * Web Push delivery for the installed PWA (Android Chrome / Samsung Internet,
 * desktop browsers alike).
 *
 * Standard Web Push with a self-managed VAPID key pair: the browser's own push
 * service connection is used, so there is no Firebase project, no third-party
 * relay and no per-message cost.
 *
 * The feature is entirely optional — with no VAPID keys configured, `enabled`
 * is false, every public method returns without touching the network, and the
 * rest of the product behaves exactly as before.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  /**
   * A notification row is usually written inside the caller's business
   * transaction. Reading it back through the plain repository on a later tick is
   * how delivery learns whether that transaction committed: a row still
   * invisible after the final attempt means the event rolled back, and no alert
   * is sent for something that never happened.
   */
  private static readonly DELIVERY_ATTEMPT_DELAYS_MS = [0, 400, 1500] as const;

  private readonly settings: PushSettings;

  constructor(
    config: ConfigService,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(PushSubscription)
    private readonly subscriptions: Repository<PushSubscription>,
  ) {
    this.settings = config.getOrThrow<PushSettings>('push');
  }

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.log('Web Push disabled: VAPID keys not configured');
      return;
    }
    webpush.setVapidDetails(
      this.settings.subject,
      this.settings.publicKey,
      this.settings.privateKey,
    );
    this.logger.log('Web Push enabled (VAPID configured)');
  }

  /** Whether this server can deliver push at all. */
  isEnabled(): boolean {
    return this.settings.enabled;
  }

  /* ------------------------------------------------------- subscriptions */

  /**
   * What the client needs to subscribe, plus the caller's registered devices.
   * Only ids and dates are returned — an endpoint URL or an encryption key must
   * never leave the server in a response body.
   */
  async getStatus(userId: string): Promise<{
    enabled: boolean;
    applicationServerKey: string | null;
    subscriptions: { id: string; createdAt: Date }[];
  }> {
    const rows = this.isEnabled()
      ? await this.subscriptions.find({
          select: { id: true, createdAt: true },
          where: { userId },
          order: { createdAt: 'DESC', id: 'DESC' },
        })
      : [];

    return {
      enabled: this.isEnabled(),
      applicationServerKey: this.isEnabled() ? this.settings.publicKey : null,
      subscriptions: rows,
    };
  }

  /**
   * Stores (or refreshes) one device for the calling user.
   *
   * `endpoint` is the identity of a subscription, so re-registering the same
   * device updates the row instead of duplicating it. A browser hands out one
   * subscription per service-worker registration and VAPID key — not per
   * business user — so an endpoint that arrives under a different account is
   * re-claimed for that account; otherwise the person who signed out would keep
   * receiving the next user's alerts on the same phone.
   */
  async register(
    userId: string,
    dto: RegisterPushSubscriptionDto,
    userAgent?: string | null,
  ): Promise<{ id: string; created: boolean }> {
    this.requireEnabled();

    const agent = userAgent ?? dto.userAgent ?? null;
    const existing = await this.subscriptions.findOne({ where: { endpoint: dto.endpoint } });

    if (existing) {
      existing.userId = userId;
      existing.p256dh = dto.keys.p256dh;
      existing.auth = dto.keys.auth;
      existing.userAgent = agent ?? existing.userAgent;
      const saved = await this.subscriptions.save(existing);
      await this.pruneOverflow(userId);
      return { id: saved.id, created: false };
    }

    const saved = await this.subscriptions.save(
      this.subscriptions.create({
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: agent,
      }),
    );
    await this.pruneOverflow(userId);
    return { id: saved.id, created: true };
  }

  /**
   * Drops a device the user switched alerts off for. A foreign id deletes
   * nothing and still answers success, so the endpoint cannot be used to probe
   * which ids belong to someone else (same rule as marking a notification read).
   */
  async unregister(userId: string, id: string): Promise<number> {
    const result = await this.subscriptions.delete({ id, userId });
    return result.affected ?? 0;
  }

  /** Sign-out / "turn every device off on this account" cleanup. */
  async unregisterAllForUser(userId: string): Promise<number> {
    const result = await this.subscriptions.delete({ userId });
    return result.affected ?? 0;
  }

  /** Keeps at most `PUSH_MAX_SUBSCRIPTIONS_PER_USER` devices, oldest first. */
  private async pruneOverflow(userId: string): Promise<void> {
    const total = await this.subscriptions.count({ where: { userId } });
    const overflow = total - this.settings.maxSubscriptionsPerUser;
    if (overflow <= 0) return;

    const stale = await this.subscriptions.find({
      select: { id: true },
      where: { userId },
      // `id` makes "the oldest" a single answer, so the same device is not kept
      // on one run and pruned on the next.
      order: { createdAt: 'ASC', id: 'ASC' },
      take: overflow,
    });
    if (stale.length === 0) return;

    await this.subscriptions.delete({ id: In(stale.map((row) => row.id)) });
    this.logger.debug(`Pruned ${stale.length} stale push subscription(s) for user ${userId}`);
  }

  /* ------------------------------------------------------------- sending */

  /**
   * Arms a best-effort delivery for every row just saved. Returns immediately: a
   * business write must never wait on, or be failed by, an external push
   * service. Failures are logged and dropped — the notification centre remains
   * the source of truth.
   */
  schedule(saved: readonly Pick<Notification, 'id' | 'userId'>[]): void {
    if (!this.isEnabled() || saved.length === 0) return;
    for (const row of saved) this.scheduleAttempt(row.id, row.userId, 0);
  }

  private scheduleAttempt(id: string, userId: string, attempt: number): void {
    const timer = setTimeout(() => {
      void this.attemptDelivery(id, userId, attempt);
    }, PushService.DELIVERY_ATTEMPT_DELAYS_MS[attempt]);
    // Never keep the process alive for a pending alert (graceful shutdown).
    timer.unref();
  }

  private async attemptDelivery(id: string, userId: string, attempt: number): Promise<void> {
    try {
      const notification = await this.notifications.findOne({ where: { id } });
      if (notification) {
        await this.deliver(notification);
        return;
      }

      const next = attempt + 1;
      if (next < PushService.DELIVERY_ATTEMPT_DELAYS_MS.length) {
        this.scheduleAttempt(id, userId, next);
        return;
      }
      // Still invisible after every attempt: the transaction behind it rolled
      // back, so there is nothing to announce.
    } catch (err) {
      this.logger.warn(`Push delivery for notification ${id} failed: ${messageOf(err)}`);
    }
  }

  private async deliver(notification: Notification): Promise<void> {
    const targets = await this.subscriptions.find({ where: { userId: notification.userId } });
    if (targets.length === 0) return;

    const payload = await this.buildPayload(notification);
    await Promise.allSettled(targets.map((target) => this.send(target, payload)));
  }

  private async buildPayload(notification: Notification): Promise<PushPayload> {
    const { resourceType, resourceId } = notification;
    const url =
      resourceType && resourceId
        ? (RESOURCE_URLS[resourceType]?.(resourceId) ?? DEFAULT_URL)
        : DEFAULT_URL;

    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      resourceType,
      resourceId,
      url,
      badgeCount: await this.unreadCount(notification.userId),
      createdAt: notification.createdAt.toISOString(),
    };
  }

  /**
   * A test alert from the opt-in UI: sent straight to the devices with no
   * `notifications` row, so verifying the setup does not litter the centre.
   * Returns how many devices the push service accepted.
   */
  async sendTest(userId: string): Promise<number> {
    this.requireEnabled();

    const targets = await this.subscriptions.find({ where: { userId } });
    if (targets.length === 0) return 0;

    const payload: PushPayload = {
      id: `test-${Date.now()}`,
      type: NotificationType.SYSTEM,
      title: 'TrackIt alerts are working',
      message: 'Price, delivery, incident and stock alerts will appear here.',
      resourceType: null,
      resourceId: null,
      url: DEFAULT_URL,
      badgeCount: await this.unreadCount(userId),
      createdAt: new Date().toISOString(),
    };

    const results = await Promise.allSettled(targets.map((target) => this.send(target, payload)));
    // Only a real acceptance counts: a dead device we just pruned is not an
    // alert anybody received.
    return results.filter((result) => result.status === 'fulfilled' && result.value).length;
  }

  /**
   * Delivers to one device and reports whether the push service accepted it.
   * Resolves rather than rejects on every known failure: one unreachable device
   * must not decide the outcome of the others, and no caller can do anything
   * useful with a single send error.
   */
  private async send(target: PushSubscription, payload: PushPayload): Promise<boolean> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { TTL: this.settings.ttlSeconds, urgency: 'high' },
      );
      return true;
    } catch (err) {
      const statusCode = (err as { statusCode?: unknown }).statusCode;
      // 404 / 410 mean the subscription is gone (the user cleared site data or
      // the browser expired it): prune it so the table does not rot.
      if (statusCode === 404 || statusCode === 410) {
        await this.subscriptions.delete({ id: target.id });
        this.logger.debug(`Pruned dead push subscription ${target.id}`);
        return false;
      }
      this.logger.warn(
        `Push to subscription ${target.id} failed${
          typeof statusCode === 'number' ? ` (HTTP ${statusCode})` : ''
        }: ${messageOf(err)}`,
      );
      return false;
    }
  }

  private unreadCount(userId: string): Promise<number> {
    return this.notifications.count({ where: { userId, status: NotificationStatus.UNREAD } });
  }

  private requireEnabled(): void {
    if (!this.isEnabled()) {
      throw invalidOperation(
        'Web Push is not configured on this server. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.',
      );
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
