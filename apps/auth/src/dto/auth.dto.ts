import { Req } from '@nestjs/common';
import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
} from 'class-validator';

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  username: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
  
  @IsString()
  captchaToken: string;
}

export class AuthResponseDto {
  access_token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
  };
}

export class UserProfileDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string | null;
  provider?: string | null;
  providerId?: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}
