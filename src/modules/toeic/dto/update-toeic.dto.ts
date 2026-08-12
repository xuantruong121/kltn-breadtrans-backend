import { PartialType } from '@nestjs/swagger';
import { CreateToeicDto } from './create-toeic.dto';

export class UpdateToeicDto extends PartialType(CreateToeicDto) {}
