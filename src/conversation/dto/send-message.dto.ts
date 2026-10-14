import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { Trimmed } from '../../common/dto/trimmed';

export class SendMessageDto {
  @ApiProperty({
    example: 'Can the cassava be delivered in 50kg sacks?',
    minLength: 1,
    maxLength: 2000,
  })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Generated once per message on the device; a retry with the same value returns the original',
  })
  @IsUUID()
  clientMessageId: string;
}
