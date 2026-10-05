import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthorizationService } from '../common/services/authorization.service';
import { apiError, notFound } from '../common/errors/api-exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import { DecimalMath } from '../common/utils/money.util';
import { resolveDateRange } from '../common/utils/date.util';
import { AuditAction, AuditResourceType, AuditService } from '../audit-logs/audit-logs.service';
import { FuelTypesService } from '../fuel-types/fuel-types.service';
import { FuelPrice } from './entities/fuel-price.entity';
import { CreateFuelPriceDto, ListFuelPricesQueryDto } from './dto/fuel-price.dto';
import { CurrentFuelPriceDto, FuelPriceResponseDto } from './dto/fuel-price-response.dto';
import { AuditActorLike } from '../common/interfaces/audit-actor.interface';

@Injectable()
export class FuelPricesService {
  private readonly logger = new Logger(FuelPricesService.name);

  constructor(
    @InjectRepository(FuelPrice)
    private readonly repository: Repository<FuelPrice>,
    private readonly dataSource: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly fuelTypes: FuelTypesService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get businessTimezone(): string {
    return this.config.getOrThrow<string>('app.businessTimezone');
  }

  toResponse(price: FuelPrice): FuelPriceResponseDto {
    return {
      id: price.id,
      fuelTypeId: price.fuelTypeId,
      pricePerLitre: price.pricePerLitre,
      effectiveFrom: price.effectiveFrom,
      effectiveTo: price.effectiveTo,
    };
  }

  /**
   * THE price-resolution function referenced across the docs
   * (docs/08 §31, PROMPT.md §18): returns the interval containing `at` under
   * half-open `[effectiveFrom, effectiveTo)` semantics.
   *
   * Sales call this rather than querying prices themselves, so two modules can
   * never disagree about what a litre cost (docs/08 §58).
   *
   * @throws 422 INVALID_FUEL_PRICE when no interval applies at that instant.
   */
  async getApplicablePrice(
    businessId: string,
    fuelTypeId: string,
    at: Date,
    manager?: EntityManager,
  ): Promise<FuelPrice> {
    const repository = manager ? manager.getRepository(FuelPrice) : this.repository;

    const price = await repository
      .createQueryBuilder('price')
      .where('price.business_id = :businessId', { businessId })
      .andWhere('price.fuel_type_id = :fuelTypeId', { fuelTypeId })
      .andWhere('price.effective_from <= :at', { at })
      .andWhere('(price.effective_to IS NULL OR price.effective_to > :at)', { at })
      .orderBy('price.effective_from', 'DESC')
      .getOne();

    if (!price) {
      throw apiError(
        ErrorCode.INVALID_FUEL_PRICE,
        'No fuel price is configured for that fuel type at the requested time.',
      );
    }

    return price;
  }

  /** The currently active interval for a fuel type, or null. */
  async findCurrent(businessId: string, fuelTypeId: string): Promise<FuelPrice | null> {
    return this.getOptionalApplicablePrice(businessId, fuelTypeId, new Date());
  }

  private async getOptionalApplicablePrice(
    businessId: string,
    fuelTypeId: string,
    at: Date,
  ): Promise<FuelPrice | null> {
    return this.repository
      .createQueryBuilder('price')
      .where('price.business_id = :businessId', { businessId })
      .andWhere('price.fuel_type_id = :fuelTypeId', { fuelTypeId })
      .andWhere('price.effective_from <= :at', { at })
      .andWhere('(price.effective_to IS NULL OR price.effective_to > :at)', { at })
      .orderBy('price.effective_from', 'DESC')
      .getOne();
  }

  async findAll(
    query: ListFuelPricesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<FuelPriceResponseDto>> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    if (!businessId) throw notFound('No business context is available.');

    const builder = this.repository
      .createQueryBuilder('price')
      .where('price.business_id = :businessId', { businessId })
      .orderBy('price.effective_from', 'DESC')
      .skip(query.skip)
      .take(query.take);

    if (query.fuelTypeId) {
      builder.andWhere('price.fuel_type_id = :fuelTypeId', { fuelTypeId: query.fuelTypeId });
    }

    if (query.active) {
      const now = new Date();
      builder
        .andWhere('price.effective_from <= :now', { now })
        .andWhere('(price.effective_to IS NULL OR price.effective_to > :now)', { now });
    }

    const range = resolveDateRange(query.from, query.to, this.businessTimezone);
    if (range) {
      builder
        .andWhere('price.effective_from <= :rangeEnd', { rangeEnd: range.end })
        .andWhere('(price.effective_to IS NULL OR price.effective_to >= :rangeStart)', {
          rangeStart: range.start,
        });
    }

    const [items, total] = await builder.getManyAndCount();
    return PaginatedResult.of(
      items.map((item) => this.toResponse(item)),
      total,
      query.pageNumber,
      query.take,
    );
  }

  async findCurrentOrFail(
    fuelTypeId: string,
    actor: AuthenticatedUser,
  ): Promise<CurrentFuelPriceDto> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    if (!businessId) throw notFound('No business context is available.');

    // Confirms the fuel type is visible to the caller before answering.
    await this.fuelTypes.findOneOrFail(fuelTypeId, actor);

    const price = await this.findCurrent(businessId, fuelTypeId);

    if (!price) {
      throw notFound('No active fuel price is configured for this fuel type.');
    }

    return {
      fuelTypeId,
      pricePerLitre: price.pricePerLitre,
      effectiveFrom: price.effectiveFrom,
      effectiveTo: price.effectiveTo,
    };
  }

  /**
   * Creates a new price interval and closes the previous one atomically.
   *
   * Closing and creating MUST be in one transaction: without it a crash between
   * the two steps leaves the fuel with no valid price at all (docs/08 §25).
   *
   * Overlap is rejected twice over — by an explicit check that yields a friendly
   * 422, and by the EXCLUDE USING gist constraint in the migration, which is the
   * final authority (docs/08 §21).
   */
  async create(
    dto: CreateFuelPriceDto,
    actor: AuthenticatedUser,
    auditActor: AuditActorLike,
  ): Promise<FuelPrice> {
    const businessId = this.authorization.resolveBusinessScope(actor);
    if (!businessId) {
      throw apiError(
        ErrorCode.VALIDATION_ERROR,
        'A business context is required to set a fuel price.',
        [{ field: 'businessId', message: 'no business is associated with your account' }],
      );
    }

    const effectiveFrom = new Date(dto.effectiveFrom);

    if (Number.isNaN(effectiveFrom.getTime())) {
      throw apiError(
        ErrorCode.VALIDATION_ERROR,
        'effectiveFrom must be a valid ISO 8601 timestamp.',
      );
    }

    // Normalise through DecimalMath so 1500 and 1500.00 store identically.
    const pricePerLitre = DecimalMath.toFixedString(
      DecimalMath.rescale(DecimalMath.parse(dto.pricePerLitre), DecimalMath.MONEY_SCALE),
      DecimalMath.MONEY_SCALE,
    );

    return this.dataSource.transaction(async (manager) => {
      // The fuel type must exist, belong to this business and be active.
      const fuelType = await this.fuelTypes.requireUsableFuelType(
        dto.fuelTypeId,
        businessId,
        manager,
      );

      const repository = manager.getRepository(FuelPrice);

      // Serialise concurrent price edits for this fuel type so two admins
      // cannot both read the same open interval and each close it.
      await repository
        .createQueryBuilder()
        .select('id')
        .where('business_id = :businessId', { businessId })
        .andWhere('fuel_type_id = :fuelTypeId', { fuelTypeId: dto.fuelTypeId })
        .setLock('pessimistic_write')
        .getMany();

      const openInterval = await repository.findOne({
        where: {
          businessId,
          fuelTypeId: dto.fuelTypeId,
          effectiveTo: IsNull(),
        },
      });

      if (openInterval && effectiveFrom.getTime() <= openInterval.effectiveFrom.getTime()) {
        throw apiError(
          ErrorCode.INVALID_FUEL_PRICE,
          'The new price must start after the current price period begins.',
          [{ field: 'effectiveFrom', message: 'must be later than the active price start' }],
        );
      }

      // Any other interval whose window intersects [effectiveFrom, ∞) is an overlap.
      const clashing = await repository
        .createQueryBuilder('price')
        .where('price.business_id = :businessId', { businessId })
        .andWhere('price.fuel_type_id = :fuelTypeId', { fuelTypeId: dto.fuelTypeId })
        .andWhere('price.effective_from >= :effectiveFrom', { effectiveFrom })
        .getOne();

      if (clashing) {
        throw apiError(
          ErrorCode.INVALID_FUEL_PRICE,
          'The new price period overlaps an existing price period.',
          [{ field: 'effectiveFrom', message: 'overlaps an existing price period' }],
        );
      }

      // Step 1: close the currently open interval at the new start.
      if (openInterval) {
        openInterval.effectiveTo = effectiveFrom;
        await repository.save(openInterval);
      }

      // Step 2: open the new interval.
      const created = repository.create({
        businessId,
        fuelTypeId: fuelType.id,
        pricePerLitre,
        effectiveFrom,
        effectiveTo: null,
        createdBy: actor.id,
      });

      const saved = await repository.save(created);

      await this.audit.record(
        { ...auditActor, userId: actor.id, businessId, branchId: null },
        {
          action: AuditAction.FUEL_PRICE_CREATED,
          resourceType: AuditResourceType.FUEL_PRICE,
          resourceId: saved.id,
          metadata: {
            fuelTypeCode: fuelType.code,
            closedPreviousPriceId: openInterval?.id ?? null,
            previousPricePerLitre: openInterval?.pricePerLitre ?? null,
          },
          newValues: this.toResponse(saved) as unknown as Record<string, unknown>,
        },
        manager,
      );

      this.logger.log(
        `Fuel price for ${fuelType.code} set to ${saved.pricePerLitre} from ${saved.effectiveFrom.toISOString()}`,
      );

      return saved;
    });
  }
}
