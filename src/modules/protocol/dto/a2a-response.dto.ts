import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class A2aResponseDto {
  @ApiProperty()
  @IsNotEmpty()
  resultPayload!: unknown;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  resultHash!: string;

  @ApiProperty()
  @IsOptional()
  receipt?: unknown;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  signature!: string;
}
