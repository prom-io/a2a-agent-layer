import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsDid, IsKeccak256Hash } from '../../../common/validators/field.validators';

export class A2aRequestDto {
  @ApiProperty({ example: 'did:prom:agent-from' })
  @IsDid()
  agentFromId!: string;

  @ApiProperty({ example: 'did:prom:agent-to' })
  @IsDid()
  agentToId!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty()
  @IsNotEmpty()
  requestPayload!: unknown;

  @ApiProperty({ example: '0xabc...' })
  @IsKeccak256Hash()
  requestHash!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  maxBudget!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsKeccak256Hash()
  policyDigest?: string;

  @ApiProperty({ required: false, description: 'Unique request nonce for replay protection' })
  @IsString()
  @IsOptional()
  nonce?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  signature!: string;
}
