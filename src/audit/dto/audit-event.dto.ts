import { ApiProperty } from '@nestjs/swagger';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  Role,
} from '../../../generated/client';

export class AuditEventActionDto {
  @ApiProperty({ example: 'View profile' })
  label: string;

  @ApiProperty({ enum: AuditResource, enumName: 'AuditResource' })
  resource: AuditResource;

  @ApiProperty({ format: 'uuid' })
  resourceId: string;
}

export class AuditEventActorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Jane Okafor' })
  name: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role: Role;
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

  @ApiProperty({ enum: AuditActorType, enumName: 'AuditActorType' })
  actorType: AuditActorType;

  @ApiProperty({ type: AuditEventActorDto, nullable: true })
  actor: AuditEventActorDto | null;
}
