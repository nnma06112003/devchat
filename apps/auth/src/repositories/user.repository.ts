import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@myorg/entities';
import { RegisterDto, UserRole } from 'apps/auth/src/dto/auth.dto';

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({ where: { email } });
  }
async findByProvider(provider: string, provider_id: string): Promise<User | null> {
    return this.repository.findOne({ where: { provider, provider_id } });
  }
  async findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id } });
  }

    async findByrefresh_token(refresh_token: string): Promise<User | null> {
    return this.repository.findOne({ where: { refresh_token } });
  }

  async create(userData: RegisterDto & { password: string }): Promise<User> {
    const user = this.repository.create({
      ...userData,
      role: userData.role || UserRole.USER,
    });
    return this.repository.save(user);
  }

  async save(user: User): Promise<User> {
    return this.repository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.repository.find();
  }

  async findByRole(role: UserRole): Promise<User[]> {
    return this.repository.find({ where: { role } });
  }
}
