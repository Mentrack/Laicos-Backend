import { ApiProperty } from '@nestjs/swagger';
import { AuditCategory, AuditResource } from '../../../generated/client';

export class AuditEventActionDto {
  @ApiProperty({ example: 'View profile' })
  label: string;

  @ApiProperty({ enum: AuditResource, enumName: 'AuditResource' })
  resource: AuditResource;

  @ApiProperty({ format: 'uuid' })
  resourceId: string;
}

export class AuditEventDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;

  @ApiProperty({ enum: AuditCategory, enumName: 'AuditCategory' })
  category: AuditCategory;

  @ApiProperty({ example: 'Profile updated' })
  title: string;

  @ApiProperty({ example: 'first name' })
  summary: string;

  @ApiProperty({ type: AuditEventActionDto, nullable: true })
  action: AuditEventActionDto | null;
}
