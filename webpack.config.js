const webpack = require('webpack');

module.exports = (options, webpack) => {
  return {
    ...options,
    externals: [
      // GRPC dependencies
      '@grpc/grpc-js',
      '@grpc/proto-loader',
      // MQTT dependencies
      'mqtt',
      // NATS dependencies
      'nats',
      // Redis dependencies
      'ioredis',
      // RabbitMQ dependencies
      'amqplib',
      'amqp-connection-manager',
      // Other optional dependencies
      'kafkajs',
      '@google-cloud/pubsub',
    ],
    plugins: [
      ...options.plugins,
      new webpack.IgnorePlugin({
        checkResource(resource) {
          // Ignore optional peer dependencies that aren't needed for TCP transport
          const lazyImports = [
            '@grpc/grpc-js',
            '@grpc/proto-loader',
            'mqtt',
            'nats',
            'ioredis',
            'amqplib',
            'amqp-connection-manager',
            'kafkajs',
            '@google-cloud/pubsub',
          ];
          return lazyImports.includes(resource);
        },
      }),
    ],
  };
};
