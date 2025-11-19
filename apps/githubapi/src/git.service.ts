import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Message, User } from '@myorg/entities';
import { Channel } from '@myorg/entities';
import { BaseService, RpcCustomException } from '@myorg/common';
import * as jwt from 'jsonwebtoken';
import { isIn } from 'class-validator';
import { CleanedCommitData } from './interfaces/commit-analysis.interface';

type InstallationAccessToken = {
  token: string;
  expires_at: string; // ISO
  permissions: Record<string, 'read' | 'write'>;
  repositories?: Array<any>;
  // ... các field khác GitHub trả về
};

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

  private genAI: any;

  async initGenAI() {
    const { GoogleGenAI } = await import('@google/genai');

    this.genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  // Trong apps/githubapi/src/git.service.ts

  private cleanCommitData(rawCommit: any): CleanedCommitData {
    // 1. Lọc danh sách files
    const cleanedFiles = rawCommit.files
      .filter((file: any) => {
        // Bỏ qua các file lock hoặc file binary/ảnh để tiết kiệm token
        const ignorePatterns = [
          'package-lock.json',
          'yarn.lock',
          '.png',
          '.jpg',
          '.svg',
        ];
        return !ignorePatterns.some((pattern) =>
          file.filename.endsWith(pattern),
        );
      })
      .map((file: any) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        // Patch là diff code. Nếu file quá lớn hoặc binary, github có thể không trả về patch.
        patch: file.patch || '[No patch data - Binary or Large File]',
      }));

    // 2. Trả về object gọn nhẹ
    return {
      message: rawCommit.commit.message,
      author: rawCommit.commit.author.name,
      date: rawCommit.commit.author.date,
      stats: rawCommit.stats,
      files: cleanedFiles,
    };
  }

  // Hàm chuyển đổi Object thành String format để đưa vào Prompt
  private formatCommitToPrompt(data: CleanedCommitData): string {
    let promptContext = `Commit Message: ${data.message}\n`;
    promptContext += `Author: ${data.author}\n`;
    promptContext += `Stats: +${data.stats.additions} / -${data.stats.deletions}\n\n`;
    promptContext += `--- CHANGES ---\n`;

    data.files.forEach((file) => {
      promptContext += `File: ${file.filename} (${file.status})\n`;
      if (file.patch) {
        promptContext += `Diff:\n${file.patch}\n`;
      }
      promptContext += `----------------\n`;
    });

    return promptContext;
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
    //console.log('GitHub token raw response:', data); // <-- Thêm dòng này

    if (!res.ok || data.error) {
      return {
        ok: false,
        status: res.status,
        error: data.error_description || data.error || JSON.stringify(data),
      };
    }

    return { ok: true, token: data.access_token as string };
  }

  async githubOAuthCallback(req: any, code: string, state?: string) {
    try {
      if (!code) {
        throw new RpcCustomException('Missing code', 400);
      }

      // 1) Đổi code -> OAuth App user token
      const result = await this.exchangeOAuthCodeForToken(code);
      if (!result.ok) {
        throw new RpcCustomException(
          `token exchange failed: ${result.status} ${result.error}`,
          400,
        );
      }
      const userToken = result.token!;

      // 2) Lấy GitHub user + email
      const ghUser = await this.fetchGitHubUser(userToken);
      let email = ghUser.email ?? (await this.fetchPrimaryEmail(userToken));
      if (!email) {
        email = `${ghUser.id}+noreply@users.github.com`; // fallback
      }

      // 3) Tìm user trong DB
      let user: any = null;
      if (state) {
        user = await this.userRepo.findOne({ where: { id: state } });
      } else {
        user = await this.userRepo.findOne({ where: { github_email: email } });
      }

      // ==== CASE: USER ĐÃ TỒN TẠI ====
      if (user) {
        user = await this.updateGithubUserInfoIfChanged(user.id, userToken);

        // (1) Nếu user đã verified → không cần install nữa
        if (user.github_verified && !state) {
          return {
            user: { id: user.id },
            isInstall: false,
          };
        }
        if (
          (!user.github_installation_id && state) ||
          (state && !user.github_verified)
        ) {
          const nextUrl = process.env.FE_URL!;
          const statePayload = { next: nextUrl, userId: user.id };
          const encoded = Buffer.from(
            JSON.stringify(statePayload),
            'utf8',
          ).toString('base64url');
          const installUrl = this.getInstallAppUrl(encoded);

          return {
            nextUrl: installUrl,
            user: { id: user.id },
            isInstall: true,
          };
        }

        // (3) Nếu chưa verified + chưa có installationId + không có state → bắt cài app
        if (!user.github_verified && !user.github_installation_id && !state) {
          const nextUrl = process.env.FE_URL!;
          const statePayload = { next: nextUrl, userId: user.id };
          const encoded = Buffer.from(
            JSON.stringify(statePayload),
            'utf8',
          ).toString('base64url');
          const installUrl = this.getInstallAppUrl(encoded);

          return {
            nextUrl: installUrl,
            user: { id: user.id },
            isInstall: true,
          };
        }

        // Mặc định fallback
        return {
          user: { id: user.id },
          isInstall: false,
        };
      }

      // ==== CASE: USER MỚI ====
      user = this.userRepo.create({
        email,
        username: ghUser.login ?? null,
        role: 'user',
        github_user_id: String(ghUser.id),
        github_avatar: ghUser.avatar_url,
        github_email: email,
        github_verified: true, // với user mới thì cho verified luôn
        provider: 'github',
        provider_id: String(ghUser.id),
      });
      await this.userRepo.save(user);

      const nextUrl = state || process.env.FE_URL!;
      const statePayload = { next: nextUrl, userId: user.id };
      const encoded = Buffer.from(
        JSON.stringify(statePayload),
        'utf8',
      ).toString('base64url');
      const installUrl = this.getInstallAppUrl(encoded);

      (req as any).session = {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          githubOAuthToken: userToken,
          githubVerified: true,
        },
      };

      return { nextUrl: installUrl, user, isInstall: true };
    } catch {
      throw new RpcCustomException(
        'Không thể xác thực người dùng GitHub hoặc đã tồn tại tài khoản',
        404,
      );
    }
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
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      //console.log('Failed to list installations:', res.status, text); // Log chi tiết lỗi
      // throw new Error('Failed to list installations');
    }
    return JSON.parse(text); // { total_count, installations: [...] }
  }

  // === Tạo App JWT để gọi API /app/... (JWT sống 10 phút) ===
  createAppJWT() {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60,
      exp: now + 9 * 60,
      iss: process.env.GITHUB_APP_ID,
    };
    const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(
      /\\n/g,
      '\n',
    );
    return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  }

  // === Đổi Installation -> Installation Access Token (IAT) ===
  async createInstallationAccessToken(installationId: number): Promise<any> {
    if (!installationId || Number.isNaN(Number(installationId))) {
      throw new RpcCustomException(
        `Invalid installationId: ${installationId}`,
        400,
      );
    }

    const appJwt = this.createAppJWT();
    const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mychat-app/1.0 (+http://localhost:3088)',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        /* optional: permissions/repositories */
      }),
    });

    const bodyText = await res.text();
    // Luôn log mã & headers để lần sau nhìn là biết
    const reqId = res.headers.get('x-github-request-id');
    const ratelimit = `${res.headers.get('x-ratelimit-remaining')}/${res.headers.get('x-ratelimit-limit')}`;
    const wwwAuth = res.headers.get('www-authenticate');

    if (res.status !== 201) {
      //console.log('[IAT] status=', res.status, 'reqId=', reqId, 'rate=', ratelimit);
      if (wwwAuth) console.error('[IAT] www-authenticate=', wwwAuth);
      //console.log('[IAT] body=', bodyText);

      // Thử parse JSON để nêu lỗi gọn
      try {
        const j = JSON.parse(bodyText);
        //console.log
        `Failed to create IAT: ${res.status} ${j.message || ''}`;
      } catch {
        //console.log
        `Failed to create IAT: ${res.status}`;
      }
    }

    try {
      return JSON.parse(bodyText) as InstallationAccessToken;
    } catch {
      //console.log('[IAT] Invalid JSON:', bodyText);
      //console.log('Invalid JSON from GitHub when creating IAT', 502);
    }
  }
  // === Dùng endpoint tĩnh (ví dụ: installation/repositories) ===
  private async fetchFromGithubEndpoint(
    userId: number,
    endpoint: string,
    params: Record<string, any> = {},
    method: string = 'GET', // Thêm phương thức để hỗ trợ GET/POST
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new RpcCustomException('User not found', 404);

    const iatRes: InstallationAccessToken =
      await this.createInstallationAccessToken(
        Number(user.github_installation_id),
      );

    const url = new URL(`https://api.github.com/${endpoint}`);
    Object.entries(params).forEach(([k, v]) =>
      url.searchParams.set(k, String(v)),
    );

    // Set up the fetch options
    const fetchOptions: RequestInit = {
      method: method, // `GET`, `POST`, `PUT`, ...
      headers: {
        Authorization: `Bearer ${iatRes.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', // Chỉ cần nếu bạn gửi JSON body
      },
    };

    // Nếu là POST/PUT, cần thêm body
    if (method === 'POST' || method === 'PUT') {
      fetchOptions.body = JSON.stringify(params); // Chuyển params thành JSON
    }

    const res = await fetch(url.toString(), fetchOptions);

    if (!res.ok) {
      throw new RpcCustomException(
        `GitHub API failed: ${res.statusText}`,
        res.status,
      );
    }

    return res.json();
  }

  async listInstallationRepos(userId: number, page = 1, perPage = 50) {
    const result = await this.fetchFromGithubEndpoint(
      userId,
      'installation/repositories',
      {
        page,
        per_page: perPage,
      },
    );
    return result;
  }

  // === Dùng url trực tiếp từ repo JSON ===
  private async fetchFromGithubUrl(
    userId: number,
    rawUrl: string,
    params: Record<string, any> = {},
  ) {
    // Đây là userid của người dùng chứ không phải installation_id
    const whereClause = params.installation_id
      ? { github_installation_id: params.installation_id }
      : { id: userId };

    const user = await this.userRepo.findOne({ where: whereClause });
    if (!user) throw new RpcCustomException('User not found', 404);

    const installationId = Number(
      user.github_installation_id ?? params.installation_id,
    );
    const iatRes = await this.createInstallationAccessToken(installationId);

    //console.log('Fetching from iatRes iatRes:', iatRes?.token, 'installation_id', installation_id);

    // Xóa template {...} trong url (ví dụ commits{/sha} -> commits)
    const cleanUrl = rawUrl.replace(/\{.*\}/, '');

    const url = new URL(cleanUrl);
    Object.entries(params).forEach(([k, v]) =>
      url.searchParams.set(k, String(v)),
    );

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${iatRes.token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    // if (!res.ok) {
    //   throw new RpcCustomException(`GitHub API failed: ${res}`, res.status);
    // }
    return res.json();
  }

  // === Dùng IAT: list repos đã cấp cho installation ===
  // Giữ nguyên listInstallationRepos (endpoint tĩnh)

  async getMultipleReposInfo(
    items: { repo_id: string; user_id: number; repo_installation: number }[],
  ) {
    const promises = items.map((item) => {
      // Giả sử endpoint repo API dùng rawUrl dựa trên repo_id
      const rawUrl = `https://api.github.com/repositories/${item.repo_id}`;
      return this.fetchFromGithubUrl(item.user_id, rawUrl);
    });

    // Chạy đồng thời với Promise.all
    const allData = await Promise.all(promises);

    // Ghép kết quả với repo_id và user_id
    return allData.map((data, index) => ({
      repo_id: items[index].repo_id,
      user_id: items[index].user_id,
      repo_installation: items[index].repo_installation,
      repo_info: data,
    }));
  }
  // Load bất kỳ theo url GitHub API có sẵn
  async loadFromRepoLink(
    userId: number,
    url: string,
    params?: Record<string, any>,
  ) {
    return this.fetchFromGithubUrl(userId, url, params);
  }

  // === Dùng IAT: tạo Pull Request ===
  async createPullRequest(
    iat: string,
    owner: string,
    repo: string,
    params: {
      title: string;
      head: string; // ví dụ: "feature-branch" hoặc "user:branch"
      base: string; // ví dụ: "main"
      body?: string;
      draft?: boolean;
    },
  ) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${iat}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      },
    );
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

  async githubAppSetup(
    userId: string,
    installationId: number,
    userToken?: string,
  ) {
    const user: any = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new RpcCustomException('User not found', 404);
    //await this.updateGithubUserInfoIfChanged(userId, userToken);
    user.github_installation_id = String(installationId);
    await this.userRepo.save(user);
    return {
      github_installation_id: installationId,
      github_user_id: user.github_user_id,
      github_login: user.github_login,
      github_email: user.github_email,
      github_avatar: user.github_avatar,
    };
  }

  async updateGithubUserInfoIfChanged(userId: string, userToken: string) {
    const user: any = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new RpcCustomException('User not found', 404);

    let changed = false;
    const ghUser = await this.fetchGitHubUser(userToken);
    const email = ghUser.email ?? (await this.fetchPrimaryEmail(userToken));
    if (ghUser) {
      if (user.github_user_id !== String(ghUser.id)) {
        user.github_user_id = String(ghUser.id);
        changed = true;
      }
      if (user.github_login !== ghUser.login) {
        user.github_login = ghUser.login;
        changed = true;
      }
      if (!user.github_verified) {
        user.github_verified = true;
        changed = true;
      }
      if (user.github_avatar !== ghUser.avatar_url) {
        user.github_avatar = ghUser.avatar_url;
        changed = true;
      }
    }

    if (email && user.github_email !== email) {
      user.github_email = email;
      changed = true;
    }

    if (changed) {
      await this.userRepo.save(user);
      return user;
    }
    return null;
  }

  async unlinkGitHubApp(userId: string | number) {
    const user: any = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new RpcCustomException('User not found', 404);
    }

    const installationId = user.github_installation_id;
    if (!installationId) {
      throw new RpcCustomException('User has no GitHub App installation', 400);
    }

    let githubUnlinkSuccess = false;

    try {
      // 1. Gửi API đến GitHub để hủy installation
      await this.deleteInstallation(Number(installationId));
      githubUnlinkSuccess = true;
      console.log(
        `✅ Successfully uninstalled GitHub App for installation ${installationId}`,
      );
    } catch (error: any) {
      console.warn(`⚠️ Failed to uninstall from GitHub: ${error.message}`);
      // Tiếp tục cleanup local data ngay cả khi GitHub API fail
    }

    // 2. Lấy repository manager đúng cách
    const repoRepo = this.messageRepo.manager.getRepository('Repository');

    // 3. Tìm tất cả repositories có cùng installation_id
    const repos: any[] = await repoRepo
      .createQueryBuilder('repo')
      .leftJoinAndSelect('repo.channels', 'channels')
      .leftJoin('repo.user', 'user')
      .where('user.github_installation_id = :installationId', {
        installationId,
      })
      .getMany();

    // 4. Xóa repo khỏi tất cả channels
    for (const repo of repos) {
      if (repo.channels && repo.channels.length > 0) {
        repo.channels = [];
        await repoRepo.save(repo);
      }
    }

    // 5. Xóa tất cả repositories của installation này
    if (repos.length > 0) {
      const repoIds = repos.map((repo) => repo.id);
      await repoRepo.delete({ id: In(repoIds) });
    }

    // 6. Reset thông tin GitHub của user
    user.github_installation_id = null;
    user.github_verified = false;
    user.github_user_id = null;
    user.github_email = null;
    user.github_avatar = null;
    await this.userRepo.save(user);

    return {
      message: 'GitHub App unlinked successfully',
      userId: user.id,
      removedInstallationId: installationId,
      removedReposCount: repos.length,
      githubUnlinkSuccess,
    };
  }

  // Hàm helper: Gửi API đến GitHub để xóa installation
  private async deleteInstallation(installationId: number) {
    const appJwt = this.createAppJWT();
    const url = `https://api.github.com/app/installations/${installationId}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mychat-app/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new RpcCustomException(
        `Failed to delete installation: ${res.status} ${errorText}`,
        res.status,
      );
    }

    return true;
  }

  async getCommitDetails(
    userId: number,
    owner: string,
    repo: string,
    sha: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new RpcCustomException('User not found', 404);

    const iatRes = await this.createInstallationAccessToken(
      Number(user.github_installation_id),
    );

    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${iatRes.token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!res.ok) {
      throw new RpcCustomException(
        `Failed to fetch commit: ${res.statusText}`,
        res.status,
      );
    }

    return res.json();
    // Response bao gồm: commit info, stats, files[] với patch/changes
  }

  async compareCommits(
    userId: number,
    owner: string,
    repo: string,
    base: string,
    head: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new RpcCustomException('User not found', 404);

    const iatRes = await this.createInstallationAccessToken(
      Number(user.github_installation_id),
    );

    const url = `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${iatRes.token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!res.ok) {
      throw new RpcCustomException(
        `Failed to compare commits: ${res.statusText}`,
        res.status,
      );
    }

    return res;
    // Response: commits[], files[], stats
  }

  async getCommitDiff(
    userId: number,
    owner: string,
    repo: string,
    sha: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new RpcCustomException('User not found', 404);

    const iatRes = await this.createInstallationAccessToken(
      Number(user.github_installation_id),
    );

    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${iatRes.token}`,
        Accept: 'application/vnd.github.v3.diff', // ⚠️ diff format
      },
    });

    if (!res.ok) {
      throw new RpcCustomException(
        `Failed to fetch diff: ${res.statusText}`,
        res.status,
      );
    }

    return res.text();
  }

  //get commit analysis from gemini
  async getCommitAnalysisFromGemini(
    userId: number,
    owner: string,
    repo: string,
    sha: string,
    prompt: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new RpcCustomException('User not found', 404);

    const rawCommit: any = await this.getCommitDetails(
      userId,
      owner,
      repo,
      sha,
    );

    console.log('Raw commit', rawCommit);

    if (!rawCommit) {
      throw new Error('Không tìm thấy commit');
    }

    const cleanedData = this.cleanCommitData(rawCommit);

    const context = this.formatCommitToPrompt(cleanedData);

    const finalPrompt = `
    ${prompt}
    
    Đây là chi tiết commit:
    ${context}
  `;

    if (!this.genAI) await this.initGenAI();

    try {
      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
      });

      return result?.text;
    } catch (error: any) {
      throw new RpcCustomException(
        `Failed to analyze commit: ${error?.message || error}`,
        500,
      );
    }
  }
}
