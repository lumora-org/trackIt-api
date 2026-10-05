import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiExcludeEndpoint()
  check(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'trackit-api',
      timestamp: new Date().toISOString(),
    };
  }
}
