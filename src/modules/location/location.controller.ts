import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LocationService } from './location.service';

@ApiTags('Locations')
@Controller('locations')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Get('vietnam/provinces')
  @ApiOperation({
    summary:
      'Lấy danh mục 34 tỉnh/thành phố trực thuộc trung ương (hậu 01/07/2025)',
  })
  getProvinces() {
    return this.locationService.getProvinces();
  }

  @Get('vietnam/wards')
  @ApiOperation({
    summary: 'Lấy danh mục phường/xã/đặc khu theo mã tỉnh/thành phố',
  })
  @ApiQuery({
    name: 'provinceCode',
    required: true,
    description: 'Mã tỉnh/thành phố',
  })
  getWards(@Query('provinceCode') provinceCode: string) {
    return this.locationService.getWards(provinceCode);
  }

  @Get('vietnam/metadata')
  @ApiOperation({
    summary: 'Thông tin nguồn dữ liệu đơn vị hành chính Việt Nam',
  })
  getMetadata() {
    return this.locationService.getSnapshotMetadata();
  }
}
