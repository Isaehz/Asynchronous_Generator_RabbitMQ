import amqp from 'amqplib';
import dotenv from 'dotenv';
import { createLogger } from '../logging/logger.js';

dotenv.config();

const logger = createLogger('rabbitmq-client');

export const QUEUES = {
  REPORTS: 'reports_queue',
  RETRY: 'reports_retry_queue',
  DLQ: 'reports_dlq'
};

export const EXCHANGES = {
  REPORTS: 'reports_exchange',
  DLX: 'reports_dlx'
};

let connection = null;
let confirmChannel = null;

export async function getRabbitChannel() {
  if (confirmChannel) return confirmChannel;

  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  try {
    connection = await amqp.connect(url);
    connection.on('error', (err) => {
      logger.error('RABBITMQ_CONNECTION_ERROR', { error: err.message });
      connection = null;
      confirmChannel = null;
    });
    connection.on('close', () => {
      logger.warn('RABBITMQ_CONNECTION_CLOSED');
      connection = null;
      confirmChannel = null;
    });

    confirmChannel = await connection.createConfirmChannel();

    // 1. Declare Main durable exchange & queue
    await confirmChannel.assertExchange(EXCHANGES.REPORTS, 'direct', { durable: true });
    
    // DLQ queue
    await confirmChannel.assertQueue(QUEUES.DLQ, { durable: true });

    // Retry Queue with Dead Letter routing back to main exchange after TTL
    await confirmChannel.assertQueue(QUEUES.RETRY, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': EXCHANGES.REPORTS,
        'x-dead-letter-routing-key': 'process_report',
        'x-message-ttl': 5000 // 5 seconds retry delay
      }
    });

    // Main Processing Queue
    await confirmChannel.assertQueue(QUEUES.REPORTS, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': QUEUES.DLQ
      }
    });

    await confirmChannel.bindQueue(QUEUES.REPORTS, EXCHANGES.REPORTS, 'process_report');

    logger.info('RABBITMQ_CHANNELS_CONFIGURED', {
      mainQueue: QUEUES.REPORTS,
      retryQueue: QUEUES.RETRY,
      dlqQueue: QUEUES.DLQ
    });

    return confirmChannel;
  } catch (err) {
    logger.error('RABBITMQ_INIT_FAILED', { error: err.message });
    throw err;
  }
}

/**
 * Publish message with publisher confirms and mandatory delivery
 */
export async function publishReportJob(payload) {
  const channel = await getRabbitChannel();

  return new Promise((resolve, reject) => {
    const messageBuffer = Buffer.from(JSON.stringify(payload));

    channel.publish(
      EXCHANGES.REPORTS,
      'process_report',
      messageBuffer,
      {
        persistent: true,
        contentType: 'application/json',
        mandatory: true
      },
      (err, ok) => {
        if (err) {
          logger.error('PUBLISHER_CONFIRM_NACK', { reportId: payload.reportId, error: err.message });
          return reject(err);
        }
        logger.info('PUBLISHER_CONFIRM_ACK', { reportId: payload.reportId });
        resolve(ok);
      }
    );
  });
}
