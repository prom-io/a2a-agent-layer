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
      poolSize: configService.get<number>('DATABASE_POOL_SIZE', 20),
      extra: {
        max: configService.get<number>('DATABASE_POOL_MAX', 20),
        min: configService.get<number>('DATABASE_POOL_MIN', 2),
        idleTimeoutMillis: configService.get<number>('DATABASE_IDLE_TIMEOUT_MS', 30_000),
        connectionTimeoutMillis: configService.get<number>('DATABASE_CONNECT_TIMEOUT_MS', 5_000),
        statement_timeout: configService.get<number>('DATABASE_STATEMENT_TIMEOUT_MS', 15_000),
      },
      maxQueryExecutionTime: configService.get<number>('DATABASE_SLOW_QUERY_MS', 1_000),
      logging: env === 'development' ? ['error', 'warn'] : ['error'],
    };
  },
};
