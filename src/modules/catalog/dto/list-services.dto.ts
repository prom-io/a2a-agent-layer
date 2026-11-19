import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDecimalString } from '../../../common/validators/field.validators';
import { CAPABILITY_PATTERN, CapabilityMatch, MAX_CAPABILITY_FILTERS } from '../catalog-filters';

export const MAX_CATALOG_PAGE_SIZE = 200;

/** `?capability=a&capability=b` and `?capability=a,b` both become ['a', 'b']. */
export const toStringList = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
};

/** Query strings carry text: only the literal words count, anything else is rejected. */
export const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class ListServicesDto {
  @ApiPropertyOptional({ description: 'Only services offered by this agent (agent UUID)' })
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({
    description:
      'Full-text search over name and description, ordered by relevance. Accepts web search ' +
      'syntax: "quoted phrase", or, -excluded. Falls back to a substring match on the name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Capability tags; repeat the parameter or separate with commas',
    example: 'translate,ocr',
  })
  @IsOptional()
  @Transform(toStringList)
  @IsArray()
  @ArrayMaxSize(MAX_CAPABILITY_FILTERS)
  @Matches(CAPABILITY_PATTERN, { each: true, message: 'each capability must be a lowercase tag' })
  capability?: string[];

  @ApiPropertyOptional({
    enum: ['all', 'any'],
    default: 'all',
    description: 'Whether a service needs every listed capability or at least one',
  })
  @IsOptional()
  @IsIn(['all', 'any'])
  capabilityMatch?: CapabilityMatch;

  @ApiPropertyOptional({ description: 'Lowest acceptable tariff base price', example: '0.01' })
  @IsOptional()
  @IsDecimalString()
  minPrice?: string;

  @ApiPropertyOptional({ description: 'Highest acceptable tariff base price', example: '1.5' })
  @IsOptional()
  @IsDecimalString()
  maxPrice?: string;

  @ApiPropertyOptional({ description: 'Only consider tariffs in this currency', example: 'PROM' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  currency?: string;

  @ApiPropertyOptional({
    description: 'true: listed and offered by an active agent; false: everything else',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  available?: boolean;

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
