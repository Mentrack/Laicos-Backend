import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorDetailDto {
  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code: string;

  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['name should not be empty'],
    description: 'Every validation message, when there is more than one',
  })
  details?: string[];
}

/** The only error body the API returns; built by HttpExceptionFilter. */
export class ErrorResponseDto {
  @ApiProperty({ example: 'Name should not be empty' })
  message: string;

  @ApiProperty({ type: ErrorDetailDto })
  error: ErrorDetailDto;
}
