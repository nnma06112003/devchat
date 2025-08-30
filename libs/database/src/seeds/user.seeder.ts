import { DataSource } from 'typeorm';
import { User } from '@myorg/entities';
import * as bcrypt from 'bcrypt';

export class UserSeeder {
  constructor(private dataSource: DataSource) {}

  async run() {
    const repo = this.dataSource.getRepository(User);

    // Kiểm tra nếu đã có admin thì không seed lại
    const exist = await repo.findOne({ where: { email: 'admin@example.com' } });
    if (exist) return;

    // Hash mật khẩu
    const adminPassword = await bcrypt.hash('admin123', 10);
    const userPassword = await bcrypt.hash('123456', 10);

    // User admin
    const admin = repo.create({
      username: 'admin',
      email: 'admin@example.com',
      password: adminPassword,
      role: 'admin',
    });

    // User thường
    const user = repo.create({
      username: 'saw',
      email: 'saw@example.com',
      password: userPassword,
      role: 'user',
    });

    await repo.save([admin, user]);

    console.log('✅ User seeding done!');
  }
}
