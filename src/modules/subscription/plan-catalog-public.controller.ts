import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PublicPlanCatalogDto } from './dto/plan-catalog-public.dto';
import { PlanCatalogPublicService } from './plan-catalog-public.service';

@ApiTags('plans')
@Controller('plans')
export class PlanCatalogPublicController {
  constructor(private readonly catalogService: PlanCatalogPublicService) {}

  @Get('catalog')
  @ApiOperation({
    summary: 'Lấy danh mục gói hiện đang được phép hiển thị và mua',
  })
  @ApiResponse({ status: 200, type: PublicPlanCatalogDto })
  getCatalog(): Promise<PublicPlanCatalogDto> {
    return this.catalogService.getCatalog();
  }
}
