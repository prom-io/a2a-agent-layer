import { IsEnum, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgentStatus } from '../entities/agent.entity';
import { IsDid, IsEthAddress, IsHttpUrl } from '../../../common/validators/field.validators';

export class RegisterAgentDto {
  @ApiProperty({ example: 'did:prom:agent-1' })
  @IsDid()
  agentDid!: string;

  @ApiProperty({ example: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' })
  @IsEthAddress()
  owner!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  publicKey!: string;

  @ApiProperty({ example: 'http://agent:8080' })
  @IsHttpUrl()
  endpoint!: string;

  @ApiProperty({
    description:
      'Signature by `owner` over the canonical registration message, proving control of the DID',
    example: '0x...',
  })
  @IsString()
  @IsNotEmpty()
  ownerSignature!: string;

  @ApiPropertyOptional({ enum: AgentStatus })
  @IsOptional()
  @IsEnum(AgentStatus)
  status?: AgentStatus;
}
