import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AgentStatus } from '../entities/agent.entity';
import { IsHttpUrl } from '../../../common/validators/field.validators';

export class UpdateAgentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  publicKey?: string;

  @ApiPropertyOptional({ example: 'http://agent:8080' })
  @IsOptional()
  @IsHttpUrl()
  endpoint?: string;

  @ApiPropertyOptional({ enum: AgentStatus })
  @IsOptional()
  @IsEnum(AgentStatus)
  status?: AgentStatus;
}
