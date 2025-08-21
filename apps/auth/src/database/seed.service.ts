import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user.entity';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async seed() {
    this.logger.log('Starting database seeding...');

    await this.seedUsers();

    this.logger.log('Database seeding completed!');
  }

  private async seedUsers() {
    const adminUser = await this.userRepository.findOne({
      where: { email: 'admin@example.com' },
    });

    if (!adminUser) {
      const hashedPassword = await bcrypt.hash('admin123', 10);

      const admin = this.userRepository.create({
        email: 'admin@example.com',
        password: hashedPassword,
        firstName: 'Admin',
        lastName: 'User',
        role: UserRole.ADMIN,
      });

      await this.userRepository.save(admin);
      this.logger.log('Admin user created successfully');
    } else {
      this.logger.log('Admin user already exists');
    }

    // Seed a regular user
    const regularUser = await this.userRepository.findOne({
      where: { email: 'user@example.com' },
    });

    if (!regularUser) {
      const hashedPassword = await bcrypt.hash('user123', 10);

      const user = this.userRepository.create({
        email: 'user@example.com',
        password: hashedPassword,
        firstName: 'Regular',
        lastName: 'User',
        role: UserRole.USER,
      });

      await this.userRepository.save(user);
      this.logger.log('Regular user created successfully');
    } else {
      this.logger.log('Regular user already exists');
    }
  }
}
