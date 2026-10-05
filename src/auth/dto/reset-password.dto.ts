import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** MVP password policy: minimum 8 characters (docs/06 §44). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export function passwordPolicyMessage(property = 'password'): string {
  return `${property} must be at least ${PASSWORD_MIN_LENGTH} characters`;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Single-use token from the reset email' })
  @IsString()
  @MaxLength(512)
  token!: string;

  // The frontend sends `password`, NOT `newPassword` (PROMPT-B.E §4.1).
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: passwordPolicyMessage() })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
