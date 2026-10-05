import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'manager@kbyglobal.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;
}
