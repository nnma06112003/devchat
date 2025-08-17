# NestJS Microservices Architecture

A production-ready NestJS monorepo with microservice architecture featuring an Authentication Service and API Gateway.

## Architecture Overview

### Services

1. **Authentication Service** (`apps/auth`)
   - Runs as a NestJS microservice using TCP transport
   - Handles user registration, login, and JWT token validation
   - In-memory user storage (easily replaceable with database)
   - JWT-based authentication with bcrypt password hashing

2. **API Gateway** (`apps/gateway`)
   - HTTP REST API server that exposes external endpoints
   - Delegates authentication requests to the Auth Service
   - Validates JWT tokens for protected routes
   - CORS enabled for development

3. **Shared Library** (`libs/shared`)
   - Common DTOs, interfaces, and constants
   - Shared across all services for consistency

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- pnpm (or npm/yarn)

### Installation

```bash
# Install dependencies
pnpm install

# Build the shared library
pnpm run build:shared
```

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
  "lastName": "Doe"
}
```

Response:

```json
{
  "access_token": "jwt-token-here",
  "user": {
    "id": "1",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
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
  "id": "1",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "createdAt": "2025-08-17T10:00:00.000Z"
}
```

#### Health Check

```http
GET /auth/health
```

Response:

```json
{
  "status": "OK",
  "timestamp": "2025-08-17T10:00:00.000Z"
}
```

## Configuration

Environment variables can be configured in `.env`:

```env
# API Gateway Configuration
GATEWAY_PORT=3000

# Authentication Service Configuration
AUTH_PORT=3001
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Development Environment
NODE_ENV=development
```

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
```

## Project Structure

```
├── apps/
│   ├── auth/                 # Authentication Microservice
│   │   ├── src/
│   │   │   ├── main.ts       # Microservice bootstrap
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts  # MessagePattern handlers
│   │   │   ├── auth.service.ts
│   │   │   ├── repositories/
│   │   │   │   └── user.repository.ts
│   │   │   └── strategies/
│   │   │       └── jwt.strategy.ts
│   │   └── test/
│   └── gateway/              # API Gateway
│       ├── src/
│       │   ├── main.ts       # HTTP server bootstrap
│       │   ├── gateway.module.ts
│       │   ├── gateway.controller.ts  # REST endpoints
│       │   ├── gateway.service.ts
│       │   ├── guards/
│       │   │   └── jwt-auth.guard.ts
│       │   └── decorators/
│       │       └── current-user.decorator.ts
│       └── test/
├── libs/
│   └── shared/               # Shared Library
│       └── src/
│           ├── dto/
│           │   └── auth.dto.ts
│           ├── interfaces/
│           │   └── auth.interface.ts
│           └── index.ts
├── .env                      # Environment configuration
├── package.json
├── nest-cli.json            # Monorepo configuration
└── tsconfig.json            # TypeScript configuration
```

## Key Features

- **Microservice Communication**: TCP transport between services
- **JWT Authentication**: Secure token-based authentication
- **Input Validation**: Class-validator for DTO validation
- **Type Safety**: Full TypeScript support with shared interfaces
- **CORS Support**: Enabled for frontend integration
- **Production Ready**: Proper error handling and security practices
- **Extensible**: Easy to add new services and features

## Next Steps

- Replace in-memory storage with a real database (PostgreSQL, MongoDB, etc.)
- Add Redis for session management and caching
- Implement refresh token mechanism
- Add logging and monitoring
- Set up Docker containers
- Add API documentation with Swagger
- Implement rate limiting and security middleware

## License

This project is licensed under the UNLICENSED License.
