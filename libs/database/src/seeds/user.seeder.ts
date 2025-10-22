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

    // Hash mật khẩu mặc định
    const defaultPassword = await bcrypt.hash('123', 10);

    // User admin
    const admin = repo.create({
      username: 'admin',
      email: 'admin@example.com',
      password: defaultPassword,
      role: 'admin',
      email_verified: true,
    });

    // 5 user thường
    const users = Array.from({ length: 5 }).map((_, i) =>
      repo.create({
        username: `user${i + 1}`,
        email: `user${i + 1}@example.com`,
        password: defaultPassword,
        role: 'user',
        email_verified: true,
      }),
    );

    await repo.save([admin, ...users]);

    console.log('✅ User seeding done! (1 admin + 5 users)');
  }
}
