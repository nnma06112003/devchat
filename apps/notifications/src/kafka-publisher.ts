// kafka-publisher.helper.ts
import { Injectable, Logger } from '@nestjs/common';
import { Kafka } from 'kafkajs';

@Injectable()
export class KafkaPublisher {
  private readonly logger = new Logger(KafkaPublisher.name);
  private producer;

  constructor() {
    const kafka = new Kafka({
      clientId: 'notification-service',
      brokers: ['localhost:29092'], // chỉnh lại config theo env của bạn
    });
    this.producer = kafka.producer();
    this.connect();
  }

  private async connect() {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async publish(topic: string, payload: any) {
    try {
      await this.producer.send({
        topic,
        messages: [{ value: JSON.stringify(payload) }],
      });
      this.logger.log(
        `Published event to ${topic}: ${JSON.stringify(payload)}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Failed to publish to ${topic}: ${errorMessage}`,
        errorStack,
      );
    }
  }
}
