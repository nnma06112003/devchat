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
  username: string,
  role: UserRole;
  github_verified: boolean;
  iat?: number;
  github_installation_id: string | null;
  exp?: number;
}

export interface AuthMessage {
  cmd: string;
  data?: any;
}

// Microservice command patterns
export const AUTH_COMMANDS = {
  REGISTER: 'svc.auth.register',
  LOGIN: 'svc.auth.login',
  VERIFY_TOKEN: 'svc.auth.verify_token',
  GET_PROFILE: 'svc.auth.get_profile',
} as const;
