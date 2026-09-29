import { ApiProperty } from '@nestjs/swagger';

export class StateDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Oyo' })
  name: string;
}

export class LgaDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  stateId: string;

  @ApiProperty({ example: 'Ogbomosho North' })
  name: string;
}
