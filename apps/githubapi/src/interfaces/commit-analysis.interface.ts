export interface CleanedFileDiff {
  filename: string;
  status: string; // 'modified', 'added', 'removed'
  additions: number;
  deletions: number;
  patch?: string; // Đây là phần quan trọng nhất
}

export interface CleanedCommitData {
  message: string;
  author: string;
  date: string;
  stats: {
    total: number;
    additions: number;
    deletions: number;
  };
  files: CleanedFileDiff[];
}
