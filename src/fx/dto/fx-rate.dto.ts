import { ApiProperty } from '@nestjs/swagger';

export class FxRateDto {
  @ApiProperty({
    type: String,
    example: '1530.123456',
    description: 'NGN per USD for dollar payments, margin applied',
  })
  rate: string;

  @ApiProperty()
  fetchedAt: Date;
}
