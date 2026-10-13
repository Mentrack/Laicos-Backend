import { ApiProperty } from '@nestjs/swagger';

export class BankDto {
  @ApiProperty({ example: 'Guaranty Trust Bank' })
  name: string;

  @ApiProperty({ example: '058' })
  code: string;
}
