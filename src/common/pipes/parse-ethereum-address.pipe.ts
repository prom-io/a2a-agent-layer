import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Normalises an Ethereum address to lowercase.
 *
 * Addresses arrive both checksummed and not; storing them as written means the
 * same controller looks like two different ones depending on who registered it.
 */
@Injectable()
export class ParseEthereumAddressPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!ETH_ADDRESS_RE.test(value)) {
      throw new BadRequestException(`"${value}" is not a valid Ethereum address`);
    }
    return value.toLowerCase();
  }
}
