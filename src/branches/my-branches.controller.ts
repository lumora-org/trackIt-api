import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { BranchResponseDto } from './dto/branch-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

/** Backs the frontend branch switcher (PROMPT-B.E §4.17). */
@ApiTags('branches')
@ApiBearerAuth('access-token')
@Controller('me/branches')
export class MyBranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @ApiOperation({
    summary: 'Branches the caller may operate on',
    description: 'A MANAGER receives exactly their own branch.',
  })
  @ApiOkResponse({ type: BranchResponseDto, isArray: true })
  async findMine(@CurrentUser() actor: AuthenticatedUser): Promise<BranchResponseDto[]> {
    return this.branches.findOperableByActor(actor);
  }
}
