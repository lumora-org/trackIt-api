import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuthorizationService } from '../common/services/authorization.service';
import { notFound } from '../common/errors/api-exception';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import {
  AuditActor,
  AuditAction,
  AuditResourceType,
  AuditService,
} from '../audit-logs/audit-logs.service';
import { Business } from './entities/business.entity';
import { CreateBusinessDto, ListBusinessesQueryDto } from './dto/business.dto';
import { BusinessResponseDto } from './dto/business-response.dto';

@Injectable()
export class BusinessesService {
  constructor(
    @InjectRepository(Business)
    private readonly repository: Repository<Business>,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  toResponse(business: Business): BusinessResponseDto {
    return {
      id: business.id,
      name: business.name,
      registrationNumber: business.registrationNumber,
      email: business.email,
      phone: business.phone,
      address: business.address,
      status: business.status,
    };
  }

  /** Platform-wide listing; SUPER_ADMIN only (docs/04 §20.1). */
  async findAll(query: ListBusinessesQueryDto): Promise<PaginatedResult<BusinessResponseDto>> {
    const builder = this.repository
      .createQueryBuilder('business')
      .where('business.deleted_at IS NULL')
      .orderBy('business.created_at', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (query.search) {
      builder.andWhere('business.name ILIKE :search', { search: `%${query.search}%` });
    }

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  /**
   * A caller may always read their own business; a foreign id answers 404 so
   * tenant membership cannot be probed (docs/06 §41).
   */
  async findOneOrFail(id: string, actor: AuthenticatedUser): Promise<Business> {
    const business = await this.repository.findOne({ where: { id } });

    if (!business) throw notFound('The requested business was not found.');
    if (!this.authorization.managesBusiness(actor, business.id)) {
      throw notFound('The requested business was not found.');
    }

    return business;
  }

  async create(
    dto: CreateBusinessDto,
    actor: AuthenticatedUser,
    auditActor: AuditActor,
    manager?: EntityManager,
  ): Promise<Business> {
    const repository = manager ? manager.getRepository(Business) : this.repository;

    const business = repository.create({
      name: dto.name.trim(),
      registrationNumber: dto.registrationNumber?.trim() ?? null,
      email: dto.email?.trim() ?? null,
      phone: dto.phone?.trim() ?? null,
      address: dto.address?.trim() ?? null,
    });

    const saved = await repository.save(business);

    await this.audit.record(
      { ...auditActor, userId: actor.id, businessId: saved.id, branchId: null },
      {
        action: AuditAction.BUSINESS_CREATED,
        resourceType: AuditResourceType.BUSINESS,
        resourceId: saved.id,
        newValues: this.toResponse(saved) as unknown as Record<string, unknown>,
      },
      manager,
    );

    return saved;
  }
}
