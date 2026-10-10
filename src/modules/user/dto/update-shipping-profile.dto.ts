import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateShippingProfileDto {
  @ApiProperty({
    description: 'Họ tên người nhận quà',
    example: 'Nguyễn Văn A',
  })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên người nhận' })
  @MaxLength(100, { message: 'Tên người nhận không quá 100 ký tự' })
  recipientName: string;

  @ApiProperty({
    description: 'Số điện thoại liên hệ nhận quà',
    example: '0987654321',
  })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập số điện thoại' })
  phone: string;

  @ApiProperty({
    description: 'Mã tỉnh/thành phố trực thuộc trung ương',
    example: '79',
  })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn tỉnh/thành phố' })
  provinceCode: string;

  @ApiProperty({ description: 'Mã phường/xã/đặc khu', example: '26734' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn phường/xã/đặc khu' })
  wardCode: string;

  @ApiProperty({
    description: 'Địa chỉ chi tiết (số nhà, tên đường, tòa nhà, thôn/ấp...)',
    example: '12 Nguyễn Văn Bảo, Tòa A',
  })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập địa chỉ chi tiết' })
  @MinLength(3, { message: 'Địa chỉ chi tiết tối thiểu 3 ký tự' })
  @MaxLength(255, { message: 'Địa chỉ chi tiết không quá 255 ký tự' })
  addressLine: string;
}
