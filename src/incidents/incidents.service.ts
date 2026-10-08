import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IncidentStatus } from '../common/enums/report.enum';
import { NotificationType } from '../common/enums/notification.enum';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, invalidOperation, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuditActorLike } from '../common/interfaces/audit-actor.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { isBareDate, toDateOnlyInTimeZone } from '../common/utils/date.util';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { BranchesService } from '../branches/branches.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IncidentReport } from './entities/incident-report.entity';
import { CreateIncidentReportDto, ListIncidentReportsQueryDto } from './dto/incident-report.dto';
import { IncidentReportResponseDto } from './dto/incident-report-response.dto';

/**
 * Branch incident reports — the manager's exception log (product decision,
 * 2026-10).
 *
 * Unlike the old daily report there are no financial figures to reconcile:
 * sales arrive through the day-total endpoint, and this module only records
 * what went wrong (government vehicles collecting fuel without paying, stock
 * variances, equipment failures) so head office can see it. An admin
 * acknowledges a report with a single REVIEWED flip; there is no
 * approve/reject workflow to fight.
 */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    @InjectRepository(IncidentReport)
    private readonly repository: Repository<IncidentReport>,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly branches: BranchesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  toResponse(report: IncidentReport): IncidentReportResponseDto {
    return {
      id: report.id,
      branchId: report.branchId,
      branchName: report.branch?.name,
      incidentDate: report.incidentDate,
      title: report.title,
      description: report.description,
      status: report.status,
      reportedBy: report.reportedBy,
      reportedByName: report.reporter?.fullName ?? null,
      reviewedBy: report.reviewedBy,
      reviewedByName: report.reviewer?.fullName ?? null,
      reviewedAt: report.reviewedAt,
      createdAt: report.createdAt,
    };
  }

  /**
   * Lists incidents. A MANAGER only ever sees their own branch; an admin may
   * filter by any branch in their business.
   */
  async findAll(
    query: ListIncidentReportsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<IncidentReportResponseDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    const forcedBranchId = this.authorization.resolveBranchScope(actor, query.branchId);

    const builder = this.repository
      .createQueryBuilder('report')
      .leftJoinAndSelect('report.branch', 'branch')
      .leftJoinAndSelect('report.reporter', 'reporter')
      .leftJoinAndSelect('report.reviewer', 'reviewer')
      .where('1 = 1')
      // Property path, not the DB column name: skip/take + joins makes TypeORM
      // resolve order criteria through entity metadata (see deliveries findAll).
      .orderBy('report.incidentDate', 'DESC')
      .addOrderBy('report.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (businessId) builder.andWhere('report.business_id = :businessId', { businessId });
    if (forcedBranchId) {
      builder.andWhere('report.branch_id = :forcedBranchId', { forcedBranchId });
    }
    if (query.status) builder.andWhere('report.status = :status', { status: query.status });
    if (query.from) builder.andWhere('report.incident_date >= :from', { from: query.from });
    if (query.to) builder.andWhere('report.incident_date <= :to', { to: query.to });

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<IncidentReport> {
    const report = await this.repository.findOne({
      where: { id },
      relations: { branch: true, reporter: true, reviewer: true },
    });

    if (!report) throw notFound('The requested incident report was not found.');

    // Fetching by id alone would be an IDOR: ownership is checked here, not in
    // the query, so the branch/business scope cannot be skipped (docs/06 §25).
    if (!this.authorization.managesBusiness(actor, report.businessId)) {
      throw notFound('The requested incident report was not found.');
    }

    this.authorization.assertBranchAccess(actor, report.branchId);

    return report;
  }

  /**
   * Raises an incident for the actor's branch. The day defaults to today in
   * the business timezone; future dates are rejected so nothing can be
   * pre-logged.
   *
   * BEGIN
   *   validate branch (business + branch scope)
   *   insert the report
   *   notify the business admins (same transaction)
   *   audit
   * COMMIT
   */
  async create(
    dto: CreateIncidentReportDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<IncidentReportResponseDto> {
    const businessId = actor.businessId;
    if (!businessId) {
      throw apiError(ErrorCode.BUSINESS_ACCESS_DENIED, 'A business context is required.');
    }

    const today = toDateOnlyInTimeZone(new Date(), this.businessTimezone);
    const incidentDate = dto.incidentDate ?? today;
    if (!isBareDate(incidentDate)) {
      throw apiError(
        ErrorCode.VALIDATION_ERROR,
        'incidentDate must be a calendar date (YYYY-MM-DD).',
      );
    }
    if (incidentDate > today) {
      throw apiError(ErrorCode.VALIDATION_ERROR, 'Incidents cannot be dated in the future.');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const branch = await this.branches.requireBranchInBusiness(dto.branchId, businessId);
      this.authorization.assertBranchAccess(actor, dto.branchId);

      const repository = manager.getRepository(IncidentReport);

      const report = repository.create({
        businessId,
        branchId: dto.branchId,
        incidentDate,
        title: dto.title.trim(),
        description: dto.description.trim(),
        status: IncidentStatus.OPEN,
        reportedBy: actor.id,
        reviewedBy: null,
        reviewedAt: null,
      });

      const persisted = await repository.save(report);

      // Head office learns immediately, in the same transaction as the report.
      await this.notifications.notifyBusinessAdmins(
        businessId,
        {
          type: NotificationType.INCIDENT_REPORTED,
          title: `Incident reported at ${branch.name}`,
          message: `${persisted.title} (${incidentDate}).`,
          resourceType: 'INCIDENT_REPORT',
          resourceId: persisted.id,
        },
        manager,
      );

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: dto.branchId },
        {
          action: AuditAction.INCIDENT_REPORT_CREATED,
          resourceType: AuditResourceType.INCIDENT_REPORT,
          resourceId: persisted.id,
          newValues: { incidentDate, title: persisted.title },
        },
        manager,
      );

      this.logger.log(`Incident ${persisted.id} reported for branch ${branch.code}`);

      // Read through the transaction manager: the global repository cannot see
      // this uncommitted row.
      return manager.getRepository(IncidentReport).findOneOrFail({
        where: { id: persisted.id },
        relations: { branch: true, reporter: true, reviewer: true },
      });
    });

    return this.toResponse(saved);
  }

  /**
   * Acknowledges an incident: OPEN -> REVIEWED, once. Re-reviewing is refused
   * with 422 INVALID_OPERATION so the reviewed timestamp stays meaningful, and
   * the reporter is told their report was seen.
   */
  async review(
    id: string,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<IncidentReportResponseDto> {
    const existing = await this.findOneOrFail(id, actor);

    if (existing.status === IncidentStatus.REVIEWED) {
      throw invalidOperation('This incident has already been reviewed.');
    }

    const businessId = existing.businessId;

    const updated = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(IncidentReport);

      const locked = await repository
        .createQueryBuilder('report')
        // Lock only the incident row: PostgreSQL refuses FOR UPDATE on the
        // nullable side of the user outer joins.
        .setLock('pessimistic_write', undefined, ['report'])
        .leftJoinAndSelect('report.branch', 'branch')
        .leftJoinAndSelect('report.reporter', 'reporter')
        .leftJoinAndSelect('report.reviewer', 'reviewer')
        .where('report.id = :id', { id })
        .getOneOrFail();

      if (locked.status === IncidentStatus.REVIEWED) {
        throw invalidOperation('This incident has already been reviewed.');
      }

      locked.status = IncidentStatus.REVIEWED;
      locked.reviewedBy = actor.id;
      locked.reviewedAt = new Date();
      await repository.save(locked);

      // The reporter may have been suspended since filing the report, so the
      // notification only goes to accounts that are still active.
      if (locked.reportedBy && locked.reportedBy !== actor.id) {
        const recipients = await this.notifications.filterActiveUsers([locked.reportedBy]);
        if (recipients.length > 0) {
          await this.notifications.notifyUser(
            locked.reportedBy,
            {
              type: NotificationType.INCIDENT_REVIEWED,
              title: 'Incident acknowledged',
              message: `Your incident "${locked.title}" has been reviewed.`,
              resourceType: 'INCIDENT_REPORT',
              resourceId: locked.id,
            },
            { businessId, manager },
          );
        }
      }

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: locked.branchId },
        {
          action: AuditAction.INCIDENT_REPORT_REVIEWED,
          resourceType: AuditResourceType.INCIDENT_REPORT,
          resourceId: locked.id,
          oldValues: { status: IncidentStatus.OPEN },
          newValues: { status: IncidentStatus.REVIEWED },
        },
        manager,
      );

      return locked;
    });

    this.logger.log(`Incident ${updated.id} reviewed by ${actor.id}`);

    return this.toResponse(updated);
  }
}
