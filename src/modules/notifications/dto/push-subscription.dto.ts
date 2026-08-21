import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class KeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class SubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @IsObject()
  keys: KeysDto;

  @IsString()
  @IsOptional()
  userAgent?: string;
}

export class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}

export class SendPushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  data?: Record<string, any>;
}
