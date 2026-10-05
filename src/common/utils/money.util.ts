/**
 * Exact decimal arithmetic for fuel quantities and money.
 *
 * PostgreSQL NUMERIC arrives from TypeORM as a string, and JavaScript floats
 * cannot represent values like 44850.125 or 12750000.01 without error. All
 * financial and volume calculations therefore run through BigInt scaled-integer
 * maths rather than `Number` (docs/05 §27, docs/08 §40).
 */

export interface Decimal {
  /** Unscaled integer value. */
  readonly units: bigint;
  /** Number of digits after the decimal point. */
  readonly scale: number;
}

export class DecimalMath {
  /** Money is NUMERIC(18,2); fuel volumes are NUMERIC(18,3). */
  static readonly MONEY_SCALE = 2;
  static readonly QUANTITY_SCALE = 3;

  /** Parses a numeric string or JS number into an exact scaled decimal. */
  static parse(input: string | number): Decimal {
    const raw = typeof input === 'number' ? this.numberToPlainString(input) : input.trim();
    if (raw === '' || raw === '-') throw new Error(`Cannot parse decimal from "${raw}"`);

    const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
    if (!match) throw new Error(`Cannot parse decimal from "${raw}"`);

    const [, sign, intPart = '', fracPart = '', exponent] = match;
    let digits = `${intPart || '0'}${fracPart}`;
    let scale = fracPart.length;

    if (exponent) {
      const shift = Number(exponent);
      scale -= shift;
    }

    if (scale < 0) {
      digits += '0'.repeat(-scale);
      scale = 0;
    }

    let units = BigInt(digits === '' ? '0' : digits);
    if (sign === '-') units = -units;

    return { units, scale };
  }

  /**
   * Coerces to the requested scale using round-half-up, which is how
   * PostgreSQL's NUMERIC rounding behaves for the values in this domain.
   */
  static rescale(value: Decimal, targetScale: number): Decimal {
    if (value.scale === targetScale) return value;
    if (value.scale < targetScale) {
      return { units: value.units * 10n ** BigInt(targetScale - value.scale), scale: targetScale };
    }

    const divisor = 10n ** BigInt(value.scale - targetScale);
    const negative = value.units < 0n;
    const magnitude = negative ? -value.units : value.units;

    const quotient = magnitude / divisor;
    const remainder = magnitude % divisor;
    const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;

    return { units: negative ? -rounded : rounded, scale: targetScale };
  }

  static add(a: Decimal, b: Decimal): Decimal {
    const scale = Math.max(a.scale, b.scale);
    const left = this.rescale(a, scale).units;
    const right = this.rescale(b, scale).units;
    return { units: left + right, scale };
  }

  static subtract(a: Decimal, b: Decimal): Decimal {
    return this.add(a, this.negate(b));
  }

  static negate(a: Decimal): Decimal {
    return { units: -a.units, scale: a.scale };
  }

  /** Exact multiplication; result keeps the combined scale. */
  static multiply(a: Decimal, b: Decimal): Decimal {
    return { units: a.units * b.units, scale: a.scale + b.scale };
  }

  /** Division rounded half-up to `targetScale`; avoids float division. */
  static divide(a: Decimal, b: Decimal, targetScale: number): Decimal {
    if (b.units === 0n) throw new Error('Division by zero');
    const numerator = a.units * 10n ** BigInt(b.scale + targetScale);
    const denominator = b.units * 10n ** BigInt(a.scale);
    return this.rescale(
      { units: this.divRoundHalfUp(numerator, denominator), scale: targetScale },
      targetScale,
    );
  }

  static compare(a: Decimal, b: Decimal): number {
    const scale = Math.max(a.scale, b.scale);
    const left = this.rescale(a, scale).units;
    const right = this.rescale(b, scale).units;
    return left === right ? 0 : left < right ? -1 : 1;
  }

  static isNegative(a: Decimal): boolean {
    return a.units < 0n;
  }

  static isZero(a: Decimal): boolean {
    return a.units === 0n;
  }

  static toFixedString(value: Decimal, scale: number): string {
    const rescaled = this.rescale(value, scale);
    const negative = rescaled.units < 0n;
    const digits = (negative ? -rescaled.units : rescaled.units)
      .toString()
      .padStart(scale + 1, '0');
    const cut = digits.length - scale;
    const body = scale === 0 ? digits : `${digits.slice(0, cut)}.${digits.slice(cut)}`;
    return negative && rescaled.units !== 0n ? `-${body}` : body;
  }

  static toNumber(value: Decimal): number {
    return Number(this.toFixedString(value, this.MONEY_SCALE));
  }

  /**
   * `litresSold × unitPrice`, with the product rounded to money precision.
   *
   * The multiplication is exact at the operands' own scales and only the result
   * is rounded — the price is deliberately NOT pre-rounded, so a caller can never
   * have an input silently altered underneath it. Callers reading a price from
   * `fuel_prices` get NUMERIC(18,2) from the database, i.e. already at
   * MONEY_SCALE, so this distinction never arises on real data.
   */
  static lineTotal(litres: string | number, unitPrice: string | number): string {
    const product = this.multiply(this.parse(litres), this.parse(unitPrice));
    return this.toFixedString(this.rescale(product, this.MONEY_SCALE), this.MONEY_SCALE);
  }

  static sum(values: Array<string | number>, scale: number): string {
    const total = values.reduce<Decimal>((acc, value) => this.add(acc, this.parse(value)), {
      units: 0n,
      scale,
    });
    return this.toFixedString(this.rescale(total, scale), scale);
  }

  private static divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
    const negative = numerator < 0n !== denominator < 0n;
    const n = numerator < 0n ? -numerator : numerator;
    const d = denominator < 0n ? -denominator : denominator;

    const quotient = n / d;
    const remainder = n % d;
    const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
    return negative ? -rounded : rounded;
  }

  /** Avoids `Number.prototype.toString()` producing exponent notation. */
  private static numberToPlainString(value: number): string {
    if (!Number.isFinite(value)) throw new Error(`Cannot parse decimal from ${value}`);
    const asString = String(value);
    if (!/e/i.test(asString)) return asString;
    return asString.toLowerCase().includes('e') ? this.expandExponential(asString) : asString;
  }

  private static expandExponential(value: string): string {
    const [mantissa, exponentPart] = value.toLowerCase().split('e');
    const exponent = Number(exponentPart);
    const negative = mantissa.startsWith('-');
    const [intPart, fracPart = ''] = mantissa.replace('-', '').split('.');
    const digits = `${intPart}${fracPart}`;
    const pointIndex = intPart.length + exponent;

    const expanded =
      pointIndex <= 0
        ? `0.${'0'.repeat(-pointIndex)}${digits}`
        : pointIndex >= digits.length
          ? `${digits}${'0'.repeat(pointIndex - digits.length)}`
          : `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;

    return negative ? `-${expanded}` : expanded;
  }
}
