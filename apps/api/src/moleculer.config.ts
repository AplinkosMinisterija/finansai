import 'dotenv/config';
import type { BrokerOptions } from 'moleculer';

const brokerConfig: BrokerOptions = {
  namespace: process.env.NAMESPACE || 'finansai',
  nodeID: process.env.NODE_ID,

  logger: {
    type: 'Console',
    options: {
      level: process.env.LOGLEVEL || 'info',
      colors: true,
      moduleColors: true,
      formatter: 'short',
      objectPrinter: null,
      autoPadding: false,
    },
  },

  logLevel: 'info',
  transporter: null,
  serializer: 'JSON',

  requestTimeout: 10 * 1000,
  retryPolicy: {
    enabled: false,
    retries: 5,
    delay: 100,
    maxDelay: 1000,
    factor: 2,
    check: (err: Error & { retryable?: boolean }) => Boolean(err && err.retryable),
  },

  maxCallLevel: 100,
  heartbeatInterval: 10,
  heartbeatTimeout: 30,

  contextParamsCloning: false,
  tracking: { enabled: false, shutdownTimeout: 5000 },
  disableBalancer: false,
  registry: { strategy: 'RoundRobin', preferLocal: true },

  circuitBreaker: {
    enabled: false,
    threshold: 0.5,
    minRequestCount: 20,
    windowTime: 60,
    halfOpenTime: 10 * 1000,
    check: (err: Error & { code?: number }) =>
      Boolean(err && err.code && err.code >= 500),
  },

  bulkhead: { enabled: false, concurrency: 10, maxQueueSize: 100 },
  validator: true,

  metrics: { enabled: false },
  tracing: { enabled: false },

  middlewares: [],

  replCommands: null,
};

export default brokerConfig;
