const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Client S3 générique (SDK AWS v3) pointé sur le stockage objet du cluster (MinIO).
// Le code reste portable vers tout stockage compatible S3 (veille / réversibilité).
// Chiffrement au repos : SSE-S3 demandé explicitement à chaque écriture, en plus du
// chiffrement par défaut configuré sur les buckets (ISO 27001 A.8.24).
function createS3Client(cfg) {
  return new S3Client({
    region: 'us-east-1',
    endpoint: `${cfg.useSSL ? 'https' : 'http'}://${cfg.endPoint}:${cfg.port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    // Compatibilité avec les implémentations S3 non-AWS.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function createStorage(cfg) {
  const client = createS3Client(cfg);
  return {
    buckets: { covers: cfg.coversBucket, receipts: cfg.receiptsBucket },
    put(bucket, key, buffer, contentType) {
      return client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType, ServerSideEncryption: 'AES256' }),
      );
    },
    async get(bucket, key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return res.Body; // Readable (Node.js)
    },
    remove(bucket, key) {
      return client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

module.exports = { createStorage, createS3Client };
