import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { toStringList } from './list-services.dto';

export const MAX_COMPARED_SERVICES = 10;

export class CompareServicesDto {
  @ApiProperty({
    type: [String],
    description: `2 to ${MAX_COMPARED_SERVICES} service UUIDs; repeat the parameter or separate with commas`,
  })
  @Transform(toStringList)
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_COMPARED_SERVICES)
  @IsUUID('all', { each: true })
  ids!: string[];
}
