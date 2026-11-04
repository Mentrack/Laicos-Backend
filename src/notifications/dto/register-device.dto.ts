import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Matches } from 'class-validator';
import { PushPlatform } from '../../../generated/client';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @Matches(/^Expo(nent)?PushToken\[[^\]]+\]$/)
  token: string;

  @ApiProperty({ enum: PushPlatform, enumName: 'PushPlatform' })
  @IsEnum(PushPlatform)
  platform: PushPlatform;
}
