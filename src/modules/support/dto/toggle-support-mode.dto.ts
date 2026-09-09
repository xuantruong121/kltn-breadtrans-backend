import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ToggleSupportModeDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['AI', 'HUMAN'])
  mode: 'AI' | 'HUMAN';
}
