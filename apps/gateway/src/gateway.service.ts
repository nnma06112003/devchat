import {
  Injectable,
  Inject,
  OnModuleInit,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import Redis from 'ioredis';
import { lastValueFrom, timeout } from 'rxjs';
import * as crypto from 'crypto';

@Injectable()
export class GatewayService implements OnModuleInit {
  private readonly algorithm = 'aes-256-cbc';
  private encryptionKey: Buffer;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Inject('KAFKA_GATEWAY') private readonly kafka: ClientKafka,
    @Inject('GATEWAY_TOPICS') private readonly topics: string[],
  ) {
    // Tạo encryption key từ env variable
    const key = process.env.ID_ENCRYPTION_KEY || 'default-secret-key-32-chars-min';
    this.encryptionKey = crypto.scryptSync(key, 'salt', 32);
  }

  async onModuleInit() {
    this.topics.forEach((t) => this.kafka.subscribeToResponseOf(t));
    await this.kafka.connect();
  }

  /**
   * Mã hóa một ID với deterministic IV
   * Format: ENC:base64(iv:encrypted)
   */
  private encryptId(id: string | number): string {
    try {
      const text = String(id);
      // Tạo IV deterministic từ ID + key
      const iv = crypto
        .createHash('md5')
        .update(text + process.env.ID_ENCRYPTION_KEY)
        .digest();
      
      const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Lưu IV + encrypted để có thể decrypt
      const combined = iv.toString('hex') + ':' + encrypted;
      return 'ENC:' + Buffer.from(combined).toString('base64');
    } catch (err) {
      console.error('❌ Encrypt ID error:', err);
      return String(id);
    }
  }

  /**
   * Giải mã ID từ format ENC:base64(iv:encrypted)
   */
  decryptId(encryptedId: string): string {
    try {
      if (!encryptedId || !encryptedId.startsWith('ENC:')) {
        return encryptedId;
      }

      const base64Data = encryptedId.substring(4);
      const combined = Buffer.from(base64Data, 'base64').toString('utf8');
      const parts = combined.split(':');
      
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (err) {
      console.error('❌ Decrypt ID error:', err);
      throw new HttpException(
        { code: 'INVALID_ENCRYPTED_ID', msg: 'ID không hợp lệ hoặc đã bị thay đổi' },
        400,
      );
    }
  }

  /**
   * Giải mã tất cả field có chứa "id" trong data (đệ quy)
   * Dùng để decode request từ frontend trước khi gửi vào service
   * Xử lý đặc biệt cho json_data/jsonData
   */
  decryptIdsInData(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    // Xử lý array
    if (Array.isArray(data)) {
      return data.map(item => {
        if (typeof item === 'string' && item.startsWith('ENC:')) {
          return this.decryptId(item);
        }
        return this.decryptIdsInData(item);
      });
    }

    // Xử lý object
    if (typeof data === 'object') {
      const result: any = {};
      
      for (const [key, value] of Object.entries(data)) {
        // Xử lý đặc biệt cho json_data/jsonData nếu là string → parse → decrypt → stringify
        if (/json_?data/i.test(key) && typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            const decrypted = this.decryptIdsInData(parsed);
            result[key] = JSON.stringify(decrypted);
          } catch {
            result[key] = value; // Nếu không parse được, giữ nguyên
          }
        }
        // Giải mã bất kỳ giá trị string nào có ENC:
        else if (typeof value === 'string' && value.startsWith('ENC:')) {
          result[key] = this.decryptId(value);
        } 
        // Đệ quy cho nested object/array
        else if (typeof value === 'object') {
          result[key] = this.decryptIdsInData(value);
        } 
        else {
          result[key] = value;
        }
      }
      
      return result;
    }

    return data;
  }

  /**
   * Mã hóa tất cả các field có chứa "id" (case-insensitive) trong data
   * Xử lý đệ quy cho object lồng nhau, array và json_data/jsonData
   */
  private encryptIdsInData(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    // Xử lý array
    if (Array.isArray(data)) {
      return data.map(item => this.encryptIdsInData(item));
    }

    // Xử lý object
    if (typeof data === 'object') {
      const result: any = {};
      
      for (const [key, value] of Object.entries(data)) {
        // Xử lý đặc biệt cho json_data/jsonData nếu là string → parse → encrypt → stringify
        if (/json_?data/i.test(key) && typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            const encrypted = this.encryptIdsInData(parsed);
            result[key] = JSON.stringify(encrypted);
          } catch {
            result[key] = value; // Nếu không parse được, giữ nguyên
          }
        }
        // Check nếu key chứa "id" và value là string/number → encrypt
        else if (/id/i.test(key) && (typeof value === 'string' || typeof value === 'number')) {
          result[key] = this.encryptId(value);
        } 
        // Đệ quy cho nested object/array
        else if (typeof value === 'object') {
          result[key] = this.encryptIdsInData(value);
        } 
        else {
          result[key] = value;
        }
      }
      
      return result;
    }

    return data;
  }

  async exec(
    service: string,
    cmd: string,
    data: any,
    opts?: { waitMs?: number; skipEncryption?: boolean },
  ) {
    const topic = `svc.${service}.exec`;
    const wait = opts?.waitMs ?? 50000;
    const skipEncryption = opts?.skipEncryption ?? false;

    try {
      // Giải mã tất cả ID trong request từ frontend trước khi gửi đến service
      const decryptedData = skipEncryption ? data : this.decryptIdsInData(data);
      

      const res$ = this.kafka
        .send<any, any>(topic, { cmd, data: decryptedData })
        .pipe(timeout(wait));
      
      const result = await lastValueFrom(res$);

      // Mã hóa response trước khi trả về (nếu không skip)
      if (!skipEncryption) {
        // Log json_data nếu có
        

        const encryptedResult = this.encryptIdsInData(result);

        

        return encryptedResult;
      }

      return result;
    } catch (err: any) {
      // Kafka + RpcException => dữ liệu thực tế nằm trong err.response
      const payload = err?.response ?? err?.message ?? err;

      if (payload?.status) {
        // Đây chính là object RpcException từ service trả về
        throw new HttpException(
          {
            code: payload.status,
            msg: payload.msg,
            data: null,
          },
          payload.status,
        );
      }

      // Timeout
      if (err?.name === 'TimeoutError') {
        throw new HttpException(
          {
            code: 'REQUEST_TIMEOUT',
            msg: `Service ${service} không phản hồi trong ${wait}ms`,
          },
          504,
        );
      }

      // Fallback
      throw new HttpException(
        { code: 'UNEXPECTED_ERROR', msg: JSON.stringify(payload) },
        500,
      );
    }
  }

  async getAllOnlineUsers(): Promise<{ code: number; msg: string; data: string[] }> {
    const all = await this.redis.hgetall("user_status");
    const onlineUsers: string[] = [];

    for (const [uid, data] of Object.entries(all)) {
      try {
        const status = JSON.parse(data);
        if (status.online) {
          onlineUsers.push(uid);
        }
      } catch (err) {
        console.error("❌ Parse user_status lỗi", uid, err);
      }
    }

    // Mã hóa user IDs trong response
    const encryptedUsers = onlineUsers.map(uid => this.encryptId(uid));

    return {
      code: 200,
      msg: 'OK',
      data: encryptedUsers,
    };
  }

  emit(service: string, cmd: string, data: any) {
    const topic = `svc.${service}.exec`;
    // Giải mã data trước khi emit đến service
    const decryptedData = this.decryptIdsInData(data);
    return this.kafka.emit(topic, { cmd, data: decryptedData });
  }
}
