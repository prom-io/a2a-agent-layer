import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('security.jwt.secret'),
        signOptions: {
          expiresIn: config.get<string>('security.jwt.expiresIn', '1h'),
        },
      }),
    }),
  ],
  providers: [JwtStrategy, JwtAuthGuard, RolesGuard, ApiKeyService, ApiKeyGuard, RefreshTokenService],
  exports: [JwtModule, PassportModule, JwtAuthGuard, RolesGuard, ApiKeyService, ApiKeyGuard, RefreshTokenService],
})
export class AuthModule {}
