import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const DID_PATTERN = /^did:[a-z0-9]+:[a-zA-Z0-9._%-]+$/;
const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const KECCAK256_PATTERN = /^(0x)?[a-fA-F0-9]{64}$/;
const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$/;
const URL_PATTERN = /^https?:\/\/.+/;

@ValidatorConstraint({ name: 'isDid', async: false })
export class IsDidConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && DID_PATTERN.test(value);
  }
  defaultMessage(): string {
    return 'value must be a valid DID (did:method:id)';
  }
}

export function IsDid(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({ target: object.constructor, propertyName, options, validator: IsDidConstraint });
  };
}

@ValidatorConstraint({ name: 'isEthAddress', async: false })
export class IsEthAddressConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && ETH_ADDRESS_PATTERN.test(value);
  }
  defaultMessage(): string {
    return 'value must be a valid Ethereum address';
  }
}

export function IsEthAddress(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: IsEthAddressConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isKeccak256Hash', async: false })
export class IsKeccak256HashConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && KECCAK256_PATTERN.test(value);
  }
  defaultMessage(): string {
    return 'value must be a 32-byte hex hash (64 hex chars, optional 0x prefix)';
  }
}

export function IsKeccak256Hash(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: IsKeccak256HashConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isDecimalString', async: false })
export class IsDecimalStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && DECIMAL_STRING_PATTERN.test(value);
  }
  defaultMessage(): string {
    return 'value must be a non-negative decimal string';
  }
}

export function IsDecimalString(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: IsDecimalStringConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isHttpUrl', async: false })
export class IsHttpUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && URL_PATTERN.test(value);
  }
  defaultMessage(): string {
    return 'value must be an http(s) URL';
  }
}

export function IsHttpUrl(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: IsHttpUrlConstraint,
    });
  };
}
