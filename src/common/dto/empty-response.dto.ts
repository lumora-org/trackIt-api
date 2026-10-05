import { ApiProperty } from '@nestjs/swagger';

/** Body used by the documented endpoints that answer with a bare message. */
export class MessageDto {
  @ApiProperty({ example: 'Operation completed successfully.' })
  message!: string;
}
