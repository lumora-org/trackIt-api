import { ApiProperty } from '@nestjs/swagger';
import { AuthenticatedUserDto } from '../../users/dto/authenticated-user.dto';

/** Login response. `refreshToken` is also set as an httpOnly cookie. */
export class LoginResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ nullable: true, description: 'Prefer the kby_refresh_token cookie' })
  refreshToken!: string | null;

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds' })
  expiresIn!: number;

  @ApiProperty({ type: AuthenticatedUserDto })
  user!: AuthenticatedUserDto;
}

export class RefreshResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds' })
  expiresIn!: number;
}
