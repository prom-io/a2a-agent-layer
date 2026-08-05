import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Strips HTML out of every string in a request body.
 *
 * Runs before ValidationPipe so that a value which only passes validation once
 * its markup is removed is still rejected on the sanitized form, not the raw one.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body') return value;
    return this.sanitize(value);
  }

  private sanitize(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.stripHtml(value).trim();
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }
    if (value !== null && typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = this.sanitize(val);
      }
      return sanitized;
    }
    return value;
  }

  private stripHtml(input: string): string {
    return input
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }
}
