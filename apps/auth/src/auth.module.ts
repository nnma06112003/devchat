import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserRepository } from './repositories/user.repository';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SeedService } from './database/seed.service';
import { User } from './entities/user.entity';
import { GithubStrategy } from './strategies/github.strategy';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST') ,
        port: configService.get('POSTGRES_PORT') ,
        username: configService.get('POSTGRES_USER') ,
        password: configService.get('POSTGRES_PASSWORD') ,
        database: configService.get('POSTGRES_DB'),
        entities: [User],
        synchronize: configService.get('NODE_ENV') === 'development',
        logging:false,
      }),
    }),
    TypeOrmModule.forFeature([User]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UserRepository, JwtStrategy, SeedService, GithubStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
