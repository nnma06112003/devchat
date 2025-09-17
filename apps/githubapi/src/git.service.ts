import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Message, User } from '@myorg/entities';
import { Channel } from '@myorg/entities';
import { BaseService, RpcCustomException } from '@myorg/common';
import * as jwt from 'jsonwebtoken';
import { log } from 'console';


@Injectable()
export class GitService extends BaseService<Message | Channel> {
  /**
   * Tham gia kênh Git
   * @param user user hiện tại
   * @param data { id: string, type: 'group' | 'personal' }
   */
  
  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    super(messageRepo);
  }


async exchangeOAuthCodeForToken(code: string) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_CALLBACK_URL,
    }),
  });

  const data = await res.json();
  console.log('GitHub token raw response:', data); // <-- Thêm dòng này

  if (!res.ok || data.error) {
    return { ok: false, status: res.status, error: data.error_description || data.error || JSON.stringify(data) };
  }

  return { ok: true, token: data.access_token as string };
}

async githubOAuthCallback(req: any, code: string, state?: string) {
  if (!code) throw new RpcCustomException('Missing code');

  // 1) Đổi code -> OAuth App user token
  const result = await this.exchangeOAuthCodeForToken(code);
  if (!result.ok) {
    throw new RpcCustomException(`token exchange failed: ${result.status} ${result.error}`, 400);
  }
  const userToken = result.token!;

  // 2) Lấy user + email
  const ghUser = await this.fetchGitHubUser(userToken);
  let email = ghUser.email ?? await this.fetchPrimaryEmail(userToken);

  // Nếu vẫn không có email, có thể dùng noreply, hoặc bắt user bổ sung ở FE
  if (!email) {
    email = `${ghUser.id}+noreply@users.github.com`; // hoặc null nếu bạn muốn buộc bổ sung sau
  }

  // 3) Upsert user
  let user: any = await this.userRepo.findOne({ where: { email } });
  if (!user) {
    user = this.userRepo.create({
      email,
      username: ghUser.login ?? null,
      role: 'user',
      github_user_id: String(ghUser.id),
      github_login: ghUser.login,
      github_avatar: ghUser.avatar_url,
      github_email: email,
      github_verified: true,
      provider: 'github',
      provider_id: String(ghUser.id),
    });
  } else {
    user.github_user_id = String(ghUser.id);
    user.github_login = ghUser.login;
    user.github_avatar = ghUser.avatar_url;
    user.github_email = email;
    user.github_verified = true;
    user.provider = user.provider ?? 'github';
    user.provider_id = user.provider_id ?? String(ghUser.id);
  }
  await this.userRepo.save(user);

  // 4) Lưu session tạm nếu bạn cần dùng tiếp ở setup
  (req as any).session = {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      githubOAuthToken: userToken,
      githubVerified: true,
    },
  };

  // // 5) Chuẩn bị payload để FE/Gateway ký JWT
  // const payload: any = {
  //   sub: user.id,
  //   email: user.email,
  //   username: user.username,
  //   role: user.role ?? 'user',
  //   github_verified: !!user.github_verified,
  // };

  // 6) Xác định nextUrl
  let nextUrl = state || process.env.FE_URL!;
  if (!user.github_installation_id) {
    const statePayload = { next: nextUrl, userId: user.id };
    const encoded = Buffer.from(JSON.stringify(statePayload), 'utf8').toString('base64url');
    nextUrl = this.getInstallAppUrl(encoded); // → URL install app
  }

  // 7) Trả về cho Gateway: có cả URL (để redirect) và payload (để set-cookie JWT)
  return nextUrl;
}

  
  


  // === Lấy user info bằng user token ===
  async fetchGitHubUser(userToken: string) {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) throw new RpcCustomException('Failed to fetch /user');
    return res.json(); // { id, login, avatar_url, email? ...}
  }

  // === Trong trường hợp email private, lấy primary email ===
  async fetchPrimaryEmail(userToken: string) {
    const res = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) return null;
    const emails = await res.json();
    const primary = emails?.find((e: any) => e.primary) ?? emails?.[0];
    return primary?.email ?? null;
  }

  // === Kiểm tra installation theo User token (user đã install app ở đâu?) ===
  async listUserInstallations(userToken: string) {
    const res = await fetch('https://api.github.com/user/installations', {
      headers: { Authorization: `Bearer ${userToken}`, Accept: 'application/vnd.github+json' },
    });
     const text = await res.text();
  if (!res.ok) {
    console.log('Failed to list installations:', res.status, text); // Log chi tiết lỗi
    // throw new Error('Failed to list installations');
  }
  return JSON.parse(text); // { total_count, installations: [...] }
  }

  // === Tạo App JWT để gọi API /app/... (JWT sống 10 phút) ===
  createAppJWT() {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // clock skew
      exp: now + 9 * 60, // 9 phút
      iss: process.env.GITHUB_APP_ID,
    };

    const token = jwt.sign(payload, process.env.GITHUB_APP_PRIVATE_KEY as string, {
      algorithm: 'RS256',
    });
    return token;
  }

  // === Đổi Installation -> Installation Access Token (IAT) ===
  async createInstallationAccessToken(installationId: number) {
    const appJwt = this.createAppJWT();
    const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to create IAT: ${res.status} ${txt}`);
    }
    return res.json(); // { token, expires_at, permissions, repositories }
  }

  // === Dùng IAT: list repos đã cấp cho installation ===
  async listInstallationRepos(iat: string, page = 1, perPage = 50) {
    const url = new URL('https://api.github.com/installation/repositories');
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${iat}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error('Failed to list installation repositories');
    return res.json(); // { total_count, repositories: [...] }
  }

  // === Dùng IAT: list branches của repo ===
  async listBranches(iat: string, owner: string, repo: string, page = 1, perPage = 50) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/branches`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${iat}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error('Failed to list branches');
    return res.json();
  }

  // === Dùng IAT: tạo Pull Request ===
  async createPullRequest(iat: string, owner: string, repo: string, params: {
    title: string;
    head: string; // ví dụ: "feature-branch" hoặc "user:branch"
    base: string; // ví dụ: "main"
    body?: string;
    draft?: boolean;
  }) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${iat}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to create PR: ${res.status} ${txt}`);
    }
    return res.json();
  }

  // === Helper: link cài đặt App ===
  getInstallAppUrl(state?: string) {
    const slug = process.env.GITHUB_APP_SLUG;
    const base = `https://github.com/apps/${slug}/installations/new`;
    if (!state) return base;
    return `${base}?state=${encodeURIComponent(state)}`; // luôn encode
  }

async githubAppSetup(userId: string, installationId: number, userToken: string) {
  // 1) Xác thực user
  const user: any = await this.userRepo.findOne({ where: { id: userId } });
  if (!user) throw new RpcCustomException('User not found', 404);

  // 2) Lấy lại thông tin GitHub user/email nếu cần
  let email = user.github_email;
  let ghUser: any = null;
  if ((!email || !user.github_user_id || !user.github_login) && userToken) {
    ghUser = await this.fetchGitHubUser(userToken);
    email = ghUser.email ?? await this.fetchPrimaryEmail(userToken);
    user.github_user_id = String(ghUser.id);
    user.github_login   = ghUser.login;
    user.github_avatar  = ghUser.avatar_url;
    if (email) user.github_email = email;
    user.github_user_token = userToken;
  }

  // 3) Lưu installation_id và xác thực
  user.github_installation_id = String(installationId);
  user.github_verified = true;

  // 4) Lấy IAT để thao tác repo
  const iatRes = await this.createInstallationAccessToken(installationId);

  // 5) Lưu các repo đã cấp quyền (nếu có)
  if (iatRes.repositories) {
    user.github_repositories = iatRes.repositories.map((r: any) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      html_url: r.html_url,
    }));
  }

  await this.userRepo.save(user);

  return {
    github_installation_id: installationId,
    github_user_id: user.github_user_id,
    github_login: user.github_login,
    github_email: user.github_email,
    github_avatar: user.github_avatar,
    github_repositories: user.github_repositories,
    iat_token: iatRes.token,
    iat_expires_at: iatRes.expires_at,
  };
}


}
