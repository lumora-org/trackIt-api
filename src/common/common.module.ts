import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './services/authorization.service';

/**
 * Cross-cutting helpers shared by every domain module. Kept dependency-free so
 * any module can import it without creating a cycle (docs/05 §25).
 */
@Global()
@Module({
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class CommonModule {}
