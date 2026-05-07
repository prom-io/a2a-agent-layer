import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProtocolService } from './protocol.service';
import { A2aRequestDto } from './dto/a2a-request.dto';

@ApiTags('a2a')
@Controller('a2a')
export class ProtocolController {
  constructor(private readonly protocolService: ProtocolService) {}

  @Post('request')
  @ApiOperation({ summary: 'Send A2A request and get processed response with signed receipt' })
  @ApiResponse({ status: 201, description: 'A2A response with receipt' })
  @ApiResponse({ status: 400, description: 'Invalid envelope or signature' })
  @ApiResponse({ status: 403, description: 'Policy denied the request' })
  async handleRequest(@Body() dto: A2aRequestDto) {
    return this.protocolService.handleRequest(dto);
  }
}
