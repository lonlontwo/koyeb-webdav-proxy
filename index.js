/**
 * Koyeb WebDAV Proxy for InfiniCLOUD (小日本碟)
 * 專門處理 InfiniCLOUD/TeraCloud 的 WebDAV 操作
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8000;

// CORS 設定 - 允許所有來源
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-drive-config', 'Authorization']
}));

app.use(express.json());
app.use(express.raw({ type: '*/*', limit: '100mb' }));

// 健康檢查
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Koyeb WebDAV Proxy',
        target: 'InfiniCLOUD / TeraCloud',
        version: '1.0.0'
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// 解析 drive config
function parseDriveConfig(req) {
    const configHeader = req.headers['x-drive-config'];
    if (!configHeader) {
        throw new Error('Missing x-drive-config header');
    }
    try {
        const json = Buffer.from(configHeader, 'base64').toString('utf8');
        return JSON.parse(json);
    } catch (e) {
        throw new Error('Invalid x-drive-config format');
    }
}

// 建立 Basic Auth Header
function makeAuthHeader(username, password) {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    return `Basic ${credentials}`;
}

// ==================== API 端點 ====================

/**
 * 列出資料夾內容 (Gateway)
 * GET /api/gateway?drive=xxx&path=/
 */
app.get('/api/gateway', async (req, res) => {
    try {
        const config = parseDriveConfig(req);
        const path = req.query.path || '/';

        // WebDAV PROPFIND 請求
        const webdavUrl = config.url.replace(/\/$/, '') + path;

        const response = await fetch(webdavUrl, {
            method: 'PROPFIND',
            headers: {
                'Authorization': makeAuthHeader(config.username, config.password),
                'Depth': '1',
                'Content-Type': 'application/xml'
            },
            body: `<?xml version="1.0" encoding="utf-8"?>
                <d:propfind xmlns:d="DAV:">
                    <d:prop>
                        <d:displayname/>
                        <d:resourcetype/>
                        <d:getcontentlength/>
                        <d:getlastmodified/>
                    </d:prop>
                </d:propfind>`
        });

        if (!response.ok) {
            return res.status(response.status).json({
                error: `WebDAV Error: ${response.status} ${response.statusText}`
            });
        }

        const xml = await response.text();
        const files = parseWebDAVResponse(xml, path);
        res.json(files);

    } catch (err) {
        console.error('Gateway Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 解析 WebDAV XML 回應
 */
function parseWebDAVResponse(xml, basePath) {
    const files = [];

    // 簡易 XML 解析（不需要額外套件）
    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/gi;
    const hrefRegex = /<d:href>([^<]+)<\/d:href>/i;
    const displaynameRegex = /<d:displayname>([^<]*)<\/d:displayname>/i;
    const collectionRegex = /<d:collection\s*\/>/i;
    const contentLengthRegex = /<d:getcontentlength>(\d+)<\/d:getcontentlength>/i;

    let match;
    while ((match = responseRegex.exec(xml)) !== null) {
        const block = match[1];

        const hrefMatch = block.match(hrefRegex);
        if (!hrefMatch) continue;

        let href = decodeURIComponent(hrefMatch[1]);

        // 跳過根目錄本身
        const normalizedBase = basePath.replace(/\/$/, '');
        const normalizedHref = href.replace(/\/$/, '');
        if (normalizedHref === normalizedBase || normalizedHref === '') continue;

        const displaynameMatch = block.match(displaynameRegex);
        const isCollection = collectionRegex.test(block);
        const contentLengthMatch = block.match(contentLengthRegex);

        // 取得檔名
        let basename = displaynameMatch ? displaynameMatch[1] : '';
        if (!basename) {
            // 從 href 取得
            const parts = href.replace(/\/$/, '').split('/');
            basename = parts[parts.length - 1];
        }

        // 跳過空的
        if (!basename) continue;

        files.push({
            filename: href,
            basename: basename,
            type: isCollection ? 'directory' : 'file',
            size: contentLengthMatch ? parseInt(contentLengthMatch[1]) : 0
        });
    }

    return files;
}

/**
 * 下載檔案
 * GET /api/download/:driveId?path=/file.jpg&auth=xxx
 */
app.get('/api/download/:driveId', async (req, res) => {
    try {
        // 從 query 取得 auth
        const authParam = req.query.auth;
        if (!authParam) {
            return res.status(400).json({ error: 'Missing auth parameter' });
        }

        const config = JSON.parse(Buffer.from(decodeURIComponent(authParam), 'base64').toString('utf8'));
        const path = req.query.path || '/';
        const preview = req.query.preview === 'true';

        const webdavUrl = config.url.replace(/\/$/, '') + path;

        const response = await fetch(webdavUrl, {
            method: 'GET',
            headers: {
                'Authorization': makeAuthHeader(config.username, config.password)
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({
                error: `Download Error: ${response.status}`
            });
        }

        // 設定回應 header
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const filename = path.split('/').pop();

        res.setHeader('Content-Type', contentType);
        if (!preview) {
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        }

        // 串流回應
        response.body.pipe(res);

    } catch (err) {
        console.error('Download Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 上傳檔案
 * PUT /api/gateway?drive=xxx&path=/newfile.jpg
 */
app.put('/api/gateway', async (req, res) => {
    try {
        const config = parseDriveConfig(req);
        const path = req.query.path || '/';

        const webdavUrl = config.url.replace(/\/$/, '') + path;

        const response = await fetch(webdavUrl, {
            method: 'PUT',
            headers: {
                'Authorization': makeAuthHeader(config.username, config.password),
                'Content-Type': req.headers['content-type'] || 'application/octet-stream'
            },
            body: req.body
        });

        if (!response.ok && response.status !== 201 && response.status !== 204) {
            return res.status(response.status).json({
                error: `Upload Error: ${response.status}`
            });
        }

        res.json({ success: true, path: path });

    } catch (err) {
        console.error('Upload Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 建立資料夾 (MKCOL)
 * POST /api/gateway?drive=xxx&path=/newfolder
 */
app.post('/api/gateway', async (req, res) => {
    try {
        const config = parseDriveConfig(req);
        const path = req.query.path || '/';

        const webdavUrl = config.url.replace(/\/$/, '') + path;

        const response = await fetch(webdavUrl, {
            method: 'MKCOL',
            headers: {
                'Authorization': makeAuthHeader(config.username, config.password)
            }
        });

        if (!response.ok && response.status !== 201) {
            return res.status(response.status).json({
                error: `Create Folder Error: ${response.status}`
            });
        }

        res.json({ success: true, path: path });

    } catch (err) {
        console.error('Create Folder Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 刪除檔案/資料夾
 * DELETE /api/gateway?drive=xxx&path=/file.jpg
 */
app.delete('/api/gateway', async (req, res) => {
    try {
        const config = parseDriveConfig(req);
        const path = req.query.path || '/';

        const webdavUrl = config.url.replace(/\/$/, '') + path;

        const response = await fetch(webdavUrl, {
            method: 'DELETE',
            headers: {
                'Authorization': makeAuthHeader(config.username, config.password)
            }
        });

        if (!response.ok && response.status !== 204) {
            return res.status(response.status).json({
                error: `Delete Error: ${response.status}`
            });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Delete Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 移動/重命名檔案
 * POST /api/move/:driveId
 */
app.post('/api/move/:driveId', async (req, res) => {
    try {
        const config = parseDriveConfig(req);
        const { from, to } = req.body;

        if (!from || !to) {
            return res.status(400).json({ error: 'Missing from or to path' });
        }

        const fromUrl = config.url.replace(/\/$/, '') + from;
        const toUrl = config.url.replace(/\/$/, '') + to;

        const response = await fetch(fromUrl, {
            method: 'MOVE',
            headers: {
                'Authorization': makeAuthHeader(config.username, config.password),
                'Destination': toUrl,
                'Overwrite': 'T'
            }
        });

        if (!response.ok && response.status !== 201 && response.status !== 204) {
            return res.status(response.status).json({
                error: `Move Error: ${response.status}`
            });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Move Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 複製檔案
 * POST /api/copy/:driveId
 */
app.post('/api/copy/:driveId', async (req, res) => {
    try {
        const config = parseDriveConfig(req);
        const { from, to } = req.body;

        if (!from || !to) {
            return res.status(400).json({ error: 'Missing from or to path' });
        }

        const fromUrl = config.url.replace(/\/$/, '') + from;
        const toUrl = config.url.replace(/\/$/, '') + to;

        const response = await fetch(fromUrl, {
            method: 'COPY',
            headers: {
                'Authorization': makeAuthHeader(config.username, config.password),
                'Destination': toUrl,
                'Overwrite': 'T'
            }
        });

        if (!response.ok && response.status !== 201 && response.status !== 204) {
            return res.status(response.status).json({
                error: `Copy Error: ${response.status}`
            });
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Copy Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`🚀 Koyeb WebDAV Proxy running on port ${PORT}`);
    console.log(`   Target: InfiniCLOUD / TeraCloud`);
});
