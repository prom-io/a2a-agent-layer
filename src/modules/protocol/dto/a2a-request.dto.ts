import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class A2aRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  agentFromId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  agentToId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty()
  @IsNotEmpty()
  requestPayload!: unknown;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  requestHash!: string;

  @ApiProperty()
  @IsNumber()
  maxBudget!: number;

  @ApiProperty()
  @IsString()
  @IsOptional()
  policyDigest?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  signature!: string;
}
