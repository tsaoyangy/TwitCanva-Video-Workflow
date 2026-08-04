import fs from 'fs';
import path from 'path';
import { TosClient } from '@volcengine/tos-sdk';

const DEFAULT_REGION = 'cn-shanghai';
const DEFAULT_ENDPOINT = 'tos-cn-shanghai.volces.com';
const DEFAULT_BUCKET = 'arkclaw--tsaoyang';
const DEFAULT_VIDEO_PREFIX = 'twitcanva/video';

function getTosConfig() {
    const accessKeyId = process.env.TOS_ACCESS_KEY_ID;
    const accessKeySecret = process.env.TOS_SECRET_ACCESS_KEY;
    const region = process.env.TOS_REGION || DEFAULT_REGION;
    const endpoint = process.env.TOS_ENDPOINT || DEFAULT_ENDPOINT;
    const bucket = process.env.TOS_BUCKET || DEFAULT_BUCKET;
    const videoPrefix = (process.env.TOS_VIDEO_PREFIX || DEFAULT_VIDEO_PREFIX).replace(/^\/+|\/+$/g, '');
    const publicBaseUrl = (process.env.TOS_PUBLIC_BASE_URL || `https://${bucket}.${endpoint}`).replace(/\/+$/g, '');

    return {
        accessKeyId,
        accessKeySecret,
        region,
        endpoint,
        bucket,
        videoPrefix,
        publicBaseUrl
    };
}

function assertTosConfigured(config = getTosConfig()) {
    if (!config.accessKeyId || !config.accessKeySecret) {
        throw new Error('TOS_ACCESS_KEY_ID or TOS_SECRET_ACCESS_KEY not configured. Add them to .env before uploading Seedance videos to TOS.');
    }
}

export function ensureTosConfigured() {
    assertTosConfigured();
}

function getClient(config = getTosConfig()) {
    assertTosConfigured(config);
    return new TosClient({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        region: config.region,
        endpoint: config.endpoint
    });
}

function encodeObjectKey(key) {
    return key.split('/').map(encodeURIComponent).join('/');
}

function buildObjectKey(filename, config = getTosConfig()) {
    return `${config.videoPrefix}/${filename}`;
}

function buildPublicUrl(objectKey, config = getTosConfig()) {
    return `${config.publicBaseUrl}/${encodeObjectKey(objectKey)}`;
}

function findVideoMetadataByFilename(videosDir, filename) {
    if (!fs.existsSync(videosDir)) return null;

    const metadataFiles = fs.readdirSync(videosDir)
        .filter(name => name.endsWith('.json'));

    for (const metadataFile of metadataFiles) {
        const metadataPath = path.join(videosDir, metadataFile);
        try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            if (metadata.filename === filename) {
                return { metadata, metadataPath };
            }
        } catch {
            // Ignore malformed metadata files.
        }
    }

    return null;
}

function getLibraryVideoFilename(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string') return null;

    let pathname = videoUrl;
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
        try {
            pathname = new URL(videoUrl).pathname;
        } catch {
            return null;
        }
    }

    const cleanPath = pathname.split('?')[0];
    if (!cleanPath.startsWith('/library/videos/')) return null;
    return path.basename(cleanPath);
}

export async function uploadVideoFileToTos(filePath, { filename = path.basename(filePath) } = {}) {
    const config = getTosConfig();
    const client = getClient(config);
    const objectKey = buildObjectKey(filename, config);

    await client.putObject({
        bucket: config.bucket,
        key: objectKey,
        body: fs.createReadStream(filePath),
        contentType: 'video/mp4',
        cacheControl: 'max-age=31536000, public'
    });

    return {
        tosBucket: config.bucket,
        tosKey: objectKey,
        tosPublicUrl: buildPublicUrl(objectKey, config)
    };
}

export async function uploadLibraryVideoToTos(videoUrl, { videosDir }) {
    const filename = getLibraryVideoFilename(videoUrl);
    if (!filename) return null;

    const existing = findVideoMetadataByFilename(videosDir, filename);
    if (existing?.metadata?.tosPublicUrl) {
        return existing.metadata.tosPublicUrl;
    }

    const filePath = path.join(videosDir, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Local video file not found for TOS upload: ${filename}`);
    }

    const uploadResult = await uploadVideoFileToTos(filePath, { filename });
    const metadataPath = existing?.metadataPath || path.join(videosDir, `${path.parse(filename).name}.json`);
    const metadata = existing?.metadata || {
        id: path.parse(filename).name,
        filename,
        createdAt: new Date().toISOString(),
        type: 'videos'
    };

    fs.writeFileSync(metadataPath, JSON.stringify({
        ...metadata,
        ...uploadResult,
        updatedAt: new Date().toISOString()
    }, null, 2));

    return uploadResult.tosPublicUrl;
}
