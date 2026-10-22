import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class RunCourseAiWorkspaceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  taskIds!: string[];
}
