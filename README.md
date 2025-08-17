# NestJS Microservices with TypeORM + PostgreSQL

A production-ready NestJS monorepo featuring microservice architecture with TypeORM, PostgreSQL, and comprehensive authentication system.

## Architecture Overview

### Services

1. **Authentication Service** (`apps/auth`)
   - Runs as a NestJS microservice using TCP transport
   - Uses TypeORM with PostgreSQL for persistence
   - Provides user management, authentication, and JWT token validation
   - Includes role-based access control (RBAC)
   - Features database seeding for initial admin user

2. **API Gateway** (`apps/gateway`)
   - HTTP REST API server that exposes external endpoints
   - Delegates authentication requests to Auth Service via TCP microservice communication
   - Validates JWT tokens for protected routes
   - CORS enabled for frontend integration

3. **Shared Library** (`libs/shared`)
   - Common DTOs, interfaces, guards, and decorators
   - Shared across all services for consistency
   - Includes role-based authorization decorators

### Database Schema

#### User Entity

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR UNIQUE NOT NULL,
  password VARCHAR NOT NULL,
  firstName VARCHAR NOT NULL,
  lastName VARCHAR NOT NULL,
  role users_role_enum NOT NULL DEFAULT 'user',
  createdAt TIMESTAMP NOT NULL DEFAULT now(),
  updatedAt TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TYPE users_role_enum AS ENUM('admin', 'user');
```

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- pnpm (or npm/yarn)
- Docker & Docker Compose

### Installation

```bash
# Install dependencies
pnpm install

# Build the shared library
pnpm run build:shared
```

### Database Setup

```bash
# Start PostgreSQL with Docker Compose
pnpm run db:create

# Run database seeding (creates admin and test users)
pnpm run db:seed
```

**Default Users Created:**

- **Admin**: `admin@example.com` / `admin123` (role: admin)
- **User**: `user@example.com` / `user123` (role: user)

### Running the Services

#### Development Mode

```bash
# Terminal 1: Start the Authentication Service
pnpm run start:auth

# Terminal 2: Start the API Gateway
pnpm run start:gateway
```

#### Production Mode

```bash
# Build all services
pnpm run build:auth
pnpm run build:gateway

# Start services
pnpm run start:auth:prod
pnpm run start:gateway:prod
```

## API Endpoints

All endpoints are available through the API Gateway at `http://localhost:3000`

### Authentication Endpoints

#### Register User

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "role": "user"  // optional, defaults to "user"
}
```

Response:

```json
{
  "access_token": "jwt-token-here",
  "user": {
    "id": "uuid-here",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "user"
  }
}
```

#### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

Response: Same as registration

#### Get Profile (Protected)

```http
GET /auth/profile
Authorization: Bearer <jwt-token>
```

Response:

```json
{
  "id": "uuid-here",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "user",
  "createdAt": "2025-08-17T10:00:00.000Z",
  "updatedAt": "2025-08-17T10:00:00.000Z"
}
```

#### Health Check

```http
GET /auth/health
```

## Configuration

Environment variables can be configured in `.env`:

```env
# API Gateway Configuration
GATEWAY_PORT=3000

# Authentication Service Configuration
AUTH_PORT=3001
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Database Configuration
DB_HOST=localhost
POSTGRES_DB=dev_chat
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_PORT=5432

# Development Environment
NODE_ENV=development
```

## Database Operations

```bash
# Start/stop PostgreSQL
pnpm run db:create
pnpm run db:stop

# Reset database (⚠️ destroys all data)
pnpm run db:drop

# Run seeding
pnpm run db:seed

# TypeORM operations
pnpm run migration:generate -- src/migrations/MigrationName
pnpm run migration:run
pnpm run migration:revert
```

## Docker Services

The `docker-compose.yml` includes:

- **PostgreSQL**: Database server with persistent storage
- **PgAdmin**: Web-based PostgreSQL administration (http://localhost:8080)
- **MongoDB**: Additional NoSQL database (if needed)
- **Redis**: Caching and session storage (if needed)

Access PgAdmin at http://localhost:8080 with:

- Email: `pgadmin@example.com`
- Password: `password`

## Testing

```bash
# Run unit tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run e2e tests
pnpm test:e2e

# Generate coverage report
pnpm test:cov

# Test API endpoints
powershell -ExecutionPolicy Bypass -File test-api.ps1
```

## Project Structure

```
├── apps/
│   ├── auth/                           # Authentication Microservice
│   │   ├── src/
│   │   │   ├── main.ts                 # Microservice bootstrap
│   │   │   ├── auth.module.ts          # TypeORM configuration
│   │   │   ├── auth.controller.ts      # MessagePattern handlers
│   │   │   ├── auth.service.ts         # Business logic
│   │   │   ├── entities/
│   │   │   │   └── user.entity.ts      # User entity with roles
│   │   │   ├── repositories/
│   │   │   │   └── user.repository.ts  # TypeORM repository
│   │   │   ├── strategies/
│   │   │   │   └── jwt.strategy.ts     # JWT validation strategy
│   │   │   └── database/
│   │   │       ├── data-source.ts      # TypeORM data source
│   │   │       ├── seed.service.ts     # Database seeding service
│   │   │       └── seed.ts             # Seeding script
│   │   └── test/
│   └── gateway/                        # API Gateway
│       ├── src/
│       │   ├── main.ts                 # HTTP server bootstrap
│       │   ├── gateway.module.ts       # Microservice client config
│       │   ├── gateway.controller.ts   # REST endpoints
│       │   ├── gateway.service.ts      # Gateway business logic
│       │   ├── guards/
│       │   │   └── jwt-auth.guard.ts   # JWT authentication guard
│       │   └── decorators/
│       │       └── current-user.decorator.ts
│       └── test/
├── libs/
│   └── shared/                         # Shared Library
│       └── src/
│           ├── dto/
│           │   └── auth.dto.ts         # Authentication DTOs
│           ├── interfaces/
│           │   └── auth.interface.ts   # Common interfaces
│           ├── guards/
│           │   └── roles.guard.ts      # Role-based authorization
│           ├── decorators/
│           │   └── roles.decorator.ts  # Role decorator
│           └── index.ts
├── docker-compose.yml                  # Database services
├── .env                               # Environment configuration
├── package.json                       # Scripts and dependencies
├── nest-cli.json                      # Monorepo configuration
└── tsconfig.json                      # TypeScript configuration
```

## Key Features

- **Microservice Communication**: TCP transport between services
- **JWT Authentication**: Secure token-based authentication with role support
- **TypeORM + PostgreSQL**: Robust database layer with migrations
- **Role-Based Access Control**: Admin/User roles with guards and decorators
- **Database Seeding**: Automated initial data setup
- **Input Validation**: Class-validator for DTO validation
- **Type Safety**: Full TypeScript support with shared interfaces
- **CORS Support**: Enabled for frontend integration
- **Docker Support**: Complete containerized database setup
- **Production Ready**: Proper error handling and security practices

## Role-Based Authorization

The system includes role-based access control:

```typescript
// Protect routes with roles
@Get('admin-only')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
async adminOnlyEndpoint() {
  return { message: 'Admin access granted' };
}
```

Available roles:

- `UserRole.ADMIN`: Full system access
- `UserRole.USER`: Standard user access

## Microservice Communication

The Gateway communicates with the Auth Service using NestJS microservices:

```typescript
// Gateway calls Auth Service
const result = await firstValueFrom(
  this.authClient.send(AUTH_COMMANDS.LOGIN, loginDto),
);
```

## Next Steps

- [ ] Add refresh token mechanism
- [ ] Implement password reset functionality
- [ ] Add email verification
- [ ] Set up logging and monitoring
- [ ] Add Redis for session management
- [ ] Implement rate limiting
- [ ] Add API documentation with Swagger
- [ ] Set up CI/CD pipeline
- [ ] Add integration tests
- [ ] Implement user management endpoints

## Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check database logs
docker logs devchat-postgres-1
```

### Service Communication Issues

```bash
# Check if auth service is listening on TCP port
netstat -an | findstr ":3001"

# Restart services in order
pnpm run start:auth
pnpm run start:gateway
```

## License

This project is licensed under the UNLICENSED License.
