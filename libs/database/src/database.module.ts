import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as Entities from '@myorg/entities';

// Config chung lấy từ env
export const makeDataSourceOptions = (config?: ConfigService): DataSourceOptions => ({
  type: 'postgres',
  host: 'localhost',
  port: parseInt(config?.get<string>('POSTGRES_PORT') || process.env.POSTGRES_PORT || '5432', 10),
  username: config?.get<string>('POSTGRES_USER') || process.env.POSTGRES_USER || 'postgres',
  password: config?.get<string>('POSTGRES_PASSWORD') || process.env.POSTGRES_PASSWORD || 'password',
  database: config?.get<string>('POSTGRES_DB') || process.env.POSTGRES_DB || 'dev_chat',
  entities: Object.values(Entities),
  migrations: ['dist/libs/database/migrations/*.js'],
  synchronize: true,
  logging: false,
});

// Xuất DataSource cho migration/seed CLI
export const dataSource = new DataSource(makeDataSourceOptions());

// Xuất DatabaseModule cho Nest runtime
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true ,envFilePath: `.env.${process.env.NODE_ENV}`}),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...makeDataSourceOptions(config),
        synchronize: true, // chỉ bật dev
      }),
    }),
  ],
})
export class DatabaseModule {}
