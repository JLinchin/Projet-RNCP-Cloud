const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

function createStorage(cfg) {
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: `${cfg.useSSL ? 'https' : 'http'}://${cfg.endPoint}:${cfg.port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return {
    put: (bucket, key, buffer, contentType) =>
      client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType, ServerSideEncryption: 'AES256' }),
      ),
    remove: (bucket, key) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
  };
}

module.exports = { createStorage };
