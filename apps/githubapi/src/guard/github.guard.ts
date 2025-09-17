// github/github.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { GitService } from '../git.service';
import { RpcCustomException } from '@myorg/common';

@Injectable()
export class GithubGuard implements CanActivate {
  constructor(private readonly gh: GitService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    // Lấy user từ session/JWT của bạn (ví dụ gắn sẵn vào req.user)
    const user = req.user as any;
    if (!user) throw new RpcCustomException('Not logged in', 401);

    if (!user.githubOAuthToken) {
      // chưa link GitHub
      throw new RpcCustomException('GitHub OAuth not linked', 403);
    }

    // Kiểm tra có installation chưa
    const installs = await this.gh.listUserInstallations(user.githubOAuthToken);
    if (!installs || installs.total_count === 0) {
      // Không chặn hẳn: tuỳ route có thể ném lỗi để FE redirect sang trang cài đặt
      throw new RpcCustomException('No GitHub App installation found', 404);
    }

    // Optionally attach the first installation id
    req.githubInstallation = installs.installations[0];
    return true;
  }
}
