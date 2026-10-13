import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { Trimmed } from '../../common/dto/trimmed';

export class SetBankAccountDto {
  @ApiProperty({ example: '058', description: 'A code from GET /banks' })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  bankCode: string;

  @ApiProperty({ example: '0123456789', description: '10-digit NUBAN' })
  @Trimmed()
  @Matches(/^\d{10}$/, { message: 'accountNumber must be 10 digits' })
  accountNumber: string;
}
