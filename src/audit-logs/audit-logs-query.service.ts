import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { notFound } from '../common/errors/api-exception';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { resolveDateRange } from '../common/utils/date.util';
import { AuditLog } from './entities/audit-log.entity';
import { AuditLogResponseDto, ListAuditLogsQueryDto } from './dto/audit-log.dto';

/**
 * Read-only access to the audit trail.
 *
 * There is deliberately no create, update or delete method exposed here beyond
 * the internal `record` used by domain services: audit rows are append-only, and
 * the migration additionally REVOKEs UPDATE and DELETE from the application
 * role (docs/03 §62).
 */
@Injectable()
export class AuditLogsQueryService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repository: Repository<AuditLog>,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  toResponse(row: AuditLog): AuditLogResponseDto {
    return {
      id: row.id,
      businessId: row.businessId,
      branchId: row.branchId,
      userId: row.userId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      oldValues: row.oldValues,
      newValues: row.newValues,
      metadata: row.metadata,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
    };
  }

  /**
   * ADMIN sees only its own business; SUPER_ADMIN sees everything
   * (docs/04 §86.1). A MANAGER has no audit access at all — the role guard on
   * the controller enforces that.
   */
  async findAll(
    query: ListAuditLogsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<AuditLogResponseDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor);

    const builder = this.repository
      .createQueryBuilder('audit')
      .where('1 = 1')
      .orderBy('audit.created_at', 'DESC')
      // One action can write several entries in the same transaction, so they
      // share created_at; `id` keeps their order stable across pages.
      .addOrderBy('audit.id', 'DESC')
      .skip(query.skip)
      .take(query.take);

    // Platform auth events legitimately carry a null business_id, so a
    // SUPER_ADMIN sees those too.
    if (businessId) {
      builder.andWhere('(audit.business_id = :businessId OR audit.business_id IS NULL)', {
        businessId,
      });
    }

    if (query.userId) builder.andWhere('audit.user_id = :userId', { userId: query.userId });
    if (query.action) builder.andWhere('audit.action = :action', { action: query.action });
    if (query.resourceType) {
      builder.andWhere('audit.resource_type = :resourceType', { resourceType: query.resourceType });
    }
    if (query.branchId)
      builder.andWhere('audit.branch_id = :branchId', { branchId: query.branchId });

    const range = resolveDateRange(query.from, query.to, this.businessTimezone);
    if (range) {
      builder
        .andWhere('audit.created_at <= :rangeEnd', { rangeEnd: range.end })
        .andWhere('audit.created_at >= :rangeStart', { rangeStart: range.start });
    }

    const [items, total] = await builder.getManyAndCount();

    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<AuditLog> {
    const row = await this.repository.findOne({ where: { id } });
    if (!row) throw notFound('The requested audit log was not found.');

    // An ADMIN must not read another business's trail. Rows with a null
    // business are platform-level events and stay visible to SUPER_ADMIN only.
    if (actor.role !== 'SUPER_ADMIN' && row.businessId !== actor.businessId) {
      throw notFound('The requested audit log was not found.');
    }

    return row;
  }
}
