import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The frontend sends an empty body `{}` and relies on the httpOnly cookie; a
 * body token is accepted as well so non-browser clients work (PROMPT-B.E §4.1).
 */
export class RefreshTokenDto {
  @ApiPropertyOptional({ description: 'Only needed when the cookie is unavailable' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}
