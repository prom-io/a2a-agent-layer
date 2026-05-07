import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const databaseConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const env = configService.get<string>('NODE_ENV', 'development');
    return {
      type: 'postgres' as const,
      host: configService.get<string>('DATABASE_HOST', 'localhost'),
      port: configService.get<number>('DATABASE_PORT', 5432),
      username: configService.get<string>('DATABASE_USER', 'postgres'),
      password: configService.get<string>('DATABASE_PASSWORD', 'postgres'),
      database: configService.get<string>('DATABASE_NAME', 'agent_db'),
      autoLoadEntities: true,
      synchronize: env === 'development',
      migrationsRun: env === 'production',
      migrations: ['dist/migrations/*.js'],
      migrationsTableName: 'typeorm_migrations',
      logging: env === 'development' ? ['error', 'warn'] : ['error'],
    };
  },
};
