
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GitService } from './git.service';

@Controller()
export class GitController {
  constructor(private readonly GitService: GitService) {}

  // Nhận message từ Gateway qua Kafka
  @MessagePattern('svc.Git.exec')
  async handleGitMessage(@Payload() payload: any) {
    switch (payload.cmd) {
      case 'ListRepo':
        return await this.GitService.ListRepo(payload.data.user, payload.data);
     
      default:
        return { error: 'Unknown command' };
    }
  }
}
