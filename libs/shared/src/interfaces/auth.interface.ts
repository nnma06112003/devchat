import { UserRole } from '../dto/auth.dto';

export interface User {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthMessage {
  cmd: string;
  data?: any;
}

// Microservice command patterns
export const AUTH_COMMANDS = {
  REGISTER: 'auth.register',
  LOGIN: 'auth.login',
  VERIFY_TOKEN: 'auth.verify_token',
  GET_PROFILE: 'auth.get_profile',
} as const;
