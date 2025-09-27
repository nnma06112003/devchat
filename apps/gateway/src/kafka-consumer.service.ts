import { Injectable } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { EventEmitter } from 'events';

@Injectable()
export class KafkaConsumerService extends EventEmitter {
  constructor() {
    super();

    const kafka = new Kafka({
      clientId: 'gateway',
      brokers: ['localhost:29092'],
    });

    const consumer = kafka.consumer({ groupId: 'gateway-group' });

    (async () => {
      await consumer.connect();
      await consumer.subscribe({ topic: 'notification.events' });

      await consumer.run({
        eachMessage: async ({ message }) => {
          if (message.value) {
            const payload = JSON.parse(message.value.toString());
            this.emit('notification', payload); // phát event cho SSE
          }
        },
      });
    })();
  }
}
