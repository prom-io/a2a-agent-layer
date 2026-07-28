import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

// did:method:identifier — method is lowercase alphanumeric per the DID spec.
const DID_RE = /^did:([a-z0-9]+):([a-zA-Z0-9._%-]+)$/;

export interface ParsedDid {
  did: string;
  method: string;
  identifier: string;
}

/**
 * Route-parameter pipe for DIDs.
 *
 * The method segment is case-sensitive in the DID spec, so it is compared as
 * written rather than lowercased: `did:PROM:x` is not the same identifier as
 * `did:prom:x` and silently folding them would merge two distinct agents.
 */
@Injectable()
export class ParseDidPipe implements PipeTransform<string, ParsedDid> {
  transform(value: string): ParsedDid {
    const match = DID_RE.exec(value ?? '');
    if (!match) {
      throw new BadRequestException(
        `"${value}" is not a valid DID, expected did:method:identifier`,
      );
    }
    const [, method, identifier] = match;
    return { did: value, method, identifier };
  }
}
