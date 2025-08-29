import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Entities from '@myorg/entities';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST') || 'localhost',
        port: parseInt(config.get('POSTGRES_PORT') || '5432', 10),
        username: config.get('POSTGRES_USER') || 'postgres',
        password: config.get('POSTGRES_PASSWORD') || 'password',
        database: config.get('POSTGRES_DB') || 'dev_chat',
        entities: Object.values(Entities),
        migrations: ['dist/libs/database/migrations/*.js'],
        synchronize: process.env.NODE_ENV === 'development'
      })
    })
  ]
})
export class DatabaseModule {}
