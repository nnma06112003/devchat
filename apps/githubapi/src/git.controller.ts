
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GitService } from './git.service';

@Controller()
export class GitController {
  constructor(private readonly GitService: GitService) {}

  // Nhận message từ Gateway qua Kafka
  @MessagePattern('svc.git.exec')
  async handleGitMessage(@Payload() payload: any) {
    switch (payload.cmd) {
     case 'github_oauth_callback':
        return await this.GitService.githubOAuthCallback(payload.data.req, payload.data.code, payload.data.state);
      case 'github_app_setup':
        return await this.GitService.githubAppSetup(payload.data.userId, payload.data.installationId, payload.data.userToken);
      case 'get_install_app_url':
        return this.GitService.getInstallAppUrl(payload.data.state);
       case 'get_repo_installation':
        return this.GitService.listInstallationRepos(payload.data.userId);
      
      default:
        return { error: 'Unknown command' };
    }
  }
}
