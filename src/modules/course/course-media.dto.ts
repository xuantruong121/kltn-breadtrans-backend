import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class SearchCourseMediaDto {
  @IsOptional() @IsString() brief?: string;
}

/** Mirrors ImageSearchCandidate (toeic image-search providers) so a candidate
 * returned by a search call can be round-tripped back on Accept and
 * re-validated server-side instead of trusted blindly. */
export class ImageSearchCandidateDto {
  @IsIn(['PEXELS', 'PIXABAY', 'OPENVERSE', 'WIKIMEDIA_COMMONS'])
  provider!: 'PEXELS' | 'PIXABAY' | 'OPENVERSE' | 'WIKIMEDIA_COMMONS';
  @IsString() @IsNotEmpty() providerAssetId!: string;
  @IsString() @IsNotEmpty() previewUrl!: string;
  @IsString() @IsNotEmpty() downloadUrl!: string;
  @IsString() @IsNotEmpty() sourcePageUrl!: string;
  @IsNumber() width!: number;
  @IsNumber() height!: number;
  @IsString() author!: string;
  @IsOptional() @IsString() authorUrl?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() licenseVersion?: string;
  @IsOptional() @IsString() licenseUrl?: string;
  @IsOptional() @IsString() attribution?: string;
  @IsArray() @IsString({ each: true }) tags!: string[];
  @IsString() license!: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class AcceptCourseMediaDto {
  @IsString() @IsNotEmpty() brief!: string;
  @ValidateNested()
  @Type(() => ImageSearchCandidateDto)
  candidate!: ImageSearchCandidateDto;
}

/** Accepts a previously generated (Cloudflare Workers AI) candidate by its
 * short-lived server-held token — the browser never carries the authoritative
 * image bytes, only a preview. */
export class AcceptGeneratedMediaDto {
  @IsString() @IsNotEmpty() token!: string;
  @IsString() @IsNotEmpty() brief!: string;
}
