import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CAPABILITY_PATTERN, MAX_CAPABILITIES_PER_SERVICE } from '../catalog-filters';

export class CreateServiceDto {
  @ApiProperty({ description: 'Agent offering the service (agent UUID)' })
  @IsUUID()
  agentId!: string;

  @ApiProperty({ example: 'Legal document translation' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'Translates contracts between English and German.' })
  @IsString()
  @MaxLength(4000)
  description!: string;

  @ApiPropertyOptional({ description: 'JSON Schema of the request payload' })
  @IsOptional()
  @IsObject()
  inputSchema?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'JSON Schema of the result payload' })
  @IsOptional()
  @IsObject()
  outputSchema?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Service level hints, e.g. { "latencyP95Ms": 800, "uptime": 0.999 }',
  })
  @IsOptional()
  @IsObject()
  slaHints?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], example: ['translate', 'legal'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CAPABILITIES_PER_SERVICE)
  @Matches(CAPABILITY_PATTERN, { each: true, message: 'each capability must be a lowercase tag' })
  capabilities?: string[];

  @ApiPropertyOptional({ default: true, description: 'Whether the listing accepts new work' })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}
