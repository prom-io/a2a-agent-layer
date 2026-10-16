import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const MAX_CATALOG_PAGE_SIZE = 200;

export class ListServicesDto {
  @ApiPropertyOptional({ description: 'Only services offered by this agent (agent UUID)' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive match on service name or description' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    enum: ['tariffs'],
    description: 'Embed the tariffs of every returned service, loaded in one batched query',
  })
  @IsOptional()
  @IsIn(['tariffs'])
  include?: 'tariffs';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ maximum: MAX_CATALOG_PAGE_SIZE, description: 'Omit to return every match' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CATALOG_PAGE_SIZE)
  limit?: number;
}
