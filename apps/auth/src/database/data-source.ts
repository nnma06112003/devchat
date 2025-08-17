import { DataSource, DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../entities/user.entity';

const configService = new ConfigService();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: configService.get('DB_HOST') || 'localhost',
  port: parseInt(configService.get('POSTGRES_PORT') || '5432'),
  username: configService.get('POSTGRES_USER') || 'postgres',
  password: configService.get('POSTGRES_PASSWORD') || 'password',
  database: configService.get('POSTGRES_DB') || 'dev_chat',
  entities: [User],
  migrations: ['dist/apps/auth/src/database/migrations/*.js'],
  migrationsTableName: 'migrations',
  logging: process.env.NODE_ENV === 'development',
  synchronize: process.env.NODE_ENV === 'development', // Only for development
};

const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
