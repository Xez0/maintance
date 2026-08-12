const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'lacak.log');
const SOURCE_IMAGE = process.env.SOURCE_IMAGE || 'https://files.catbox.moe/65ny5e.jpg';

const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

let sharp = null;
try {
    sharp = require('sharp');
} catch (e) {
    try {
        sharp = require('/home/xez/botwaxez/node_modules/sharp');
    } catch (e2) {}
}

function download(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, { headers: { 'User-Agent': 'XezTracker/1.0' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                res.resume();
                return download(res.headers.location).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error('HTTP ' + res.statusCode));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket.remoteAddress
        || 'unknown';
}

const geoCache = new Map();

function downloadJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'XezTracker/1.0', 'Accept': 'application/json' }, timeout: 5000 }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error('HTTP ' + res.statusCode));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch (e) { reject(e); }
            });
        }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
    });
}

function isPrivateIp(ip) {
    return !ip || ip === 'unknown' || ip.startsWith('::1')
        || ip.startsWith('127.') || ip.startsWith('10.')
        || ip.startsWith('192.168.') || ip.startsWith('172.16.') || ip.startsWith('172.31.')
        || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

async function geoLookup(ip) {
    if (geoCache.has(ip)) return geoCache.get(ip);
    const empty = () => {
        const r = { geo: {}, uaParsed: {} };
        geoCache.set(ip, r);
        return r;
    };
    if (isPrivateIp(ip)) return empty();
    try {
        const j = await downloadJson('https://ipapi.co/' + encodeURIComponent(ip) + '/json/');
        const r = {
            geo: {
                city: j.city || '',
                region: j.region || '',
                country: j.country_name || '',
                code: j.country_code || '',
                org: (j.org || j.org_name || '').slice(0, 60)
            },
            uaParsed: {}
        };
        geoCache.set(ip, r);
        return r;
    } catch (e) {
        return empty();
    }
}

function uaSummary(ua) {
    const s = ua || 'unknown';
    let out = s.slice(0, 64);
    if (/WhatsApp/i.test(s)) {
        const v = s.match(/WhatsApp[\/ ]?([\d.]+)?/i);
        out = 'WhatsApp ' + (v && v[1] ? v[1] : '');
        if (/Android/i.test(s)) out += ' / Android';
        if (/iPhone|iPad|iOS/i.test(s)) out += ' / iOS';
        if (/Windows/i.test(s)) out += ' / Win';
        return out;
    }
    if (/curl/i.test(s)) return 'curl';
    return out;
}

function logHit(id, req, ip, geo, device) {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        const entry = {
            ts: new Date().toISOString(),
            id,
            ip,
            device,
            geo,
            ua: req.headers['user-agent'] || '',
            referer: req.headers['referer'] || '',
            range: req.headers['range'] || '',
            method: req.method
        };
        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
        console.log('[LACAL]', JSON.stringify(entry));
    } catch (e) {
        console.error('[LACAL] log error:', e.message);
    }
}

function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shortTxt(s, max) {
    s = String(s || '').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function makeOverlay(ip, id, geo, device) {
    const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const city = shortTxt([geo.city, geo.region].filter(Boolean).join(', ') || '', 40);
    const loc = city ? city + (geo.country ? ' • ' + geo.country + (geo.code ? ' (' + geo.code + ')' : '') : '') : '';
    const org = shortTxt(geo.org || '', 46);
    const locLine = loc ? loc + (org ? ' • ' + org : '') : (org || (isPrivateIp(ip) ? '(private / local network)' : ''));

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="736" height="170">'
        + '<rect width="736" height="170" fill="rgba(0,0,0,0.62)"/>'
        + '<text x="24" y="46" font-family="monospace" font-size="32" fill="#00ff88" font-weight="bold">IP: ' + escapeXml(ip) + '</text>'
        + '<text x="24" y="84" font-family="monospace" font-size="19" fill="#ffffff">📍 ' + escapeXml(locLine) + '</text>'
        + '<text x="24" y="116" font-family="monospace" font-size="18" fill="#dfe6ee">📱 ' + escapeXml(device) + '</text>'
        + '<text x="24" y="150" font-family="monospace" font-size="16" fill="#9fb3c8">' + escapeXml(id) + ' | ' + escapeXml(time) + '</text>'
        + '</svg>';
    return Buffer.from(svg);
}

async function renderImage(ip, id, geo, device) {
    if (!sharp) return imageBuf;
    try {
        const out = await sharp(imageBuf)
            .composite([{ input: makeOverlay(ip, id, geo, device), top: 0, left: 0 }])
            .jpeg({ quality: 88 })
            .toBuffer();
        fs.writeFileSync(path.join(__dirname, 'last-render.jpg'), out);
        return out;
    } catch (e) {
        console.error('[LACAL] overlay error:', e.message);
        return imageBuf;
    }
}

let imageBuf = null;
let imageType = 'image/jpeg';
let imageReady = false;

function htmlPage(ip, geo, device, id) {
    const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const city = shortTxt([geo.city, geo.region].filter(Boolean).join(', ') || '', 40);
    const loc = city ? city + (geo.country ? ' • ' + geo.country + (geo.code ? ' (' + geo.code + ')' : '') : '') : '';
    const org = shortTxt(geo.org || '', 46);
    const locLine = loc ? loc + (org ? ' • ' + org : '') : (org || (isPrivateIp(ip) ? 'private / local network' : ''));
    const rows = [
        ['IP Address', ip],
        ['Location', locLine],
        ['Device', device],
        ['Hit ID', id],
        ['Time', time]
    ];
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<title>Xez Tracker</title>'
        + '<style>body{background:#0b1220;color:#dfe6ee;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}'
        + '.card{background:#111a2c;border:1px solid #22304a;border-radius:12px;padding:32px 40px;max-width:640px;width:90%}'
        + 'h1{color:#00ff88;font-size:22px;margin:0 0 20px}table{width:100%;border-collapse:collapse}'
        + 'td{padding:10px 6px;border-bottom:1px solid #1c2840;font-size:15px}td:first-child{color:#8299b8;width:110px}'
        + 'td:last-child{word-break:break-all}.foot{margin-top:18px;color:#5b7ca3;font-size:12px}</style></head><body><div class="card">'
        + '<h1>Xez Tracker</h1><table>'
        + rows.map(r => '<tr><td>' + escapeXml(r[0]) + '</td><td>' + escapeXml(r[1]) + '</td></tr>').join('')
        + '</table><div class="foot">xez.my.id</div></div></body></html>';
    return Buffer.from(html);
}

async function start() {
    try {
        if (/^https?:\/\//i.test(SOURCE_IMAGE)) {
            imageBuf = await download(SOURCE_IMAGE);
            imageType = IMAGE_TYPES[path.extname(new URL(SOURCE_IMAGE).pathname).toLowerCase()] || 'image/jpeg';
        } else {
            imageBuf = fs.readFileSync(SOURCE_IMAGE);
            imageType = IMAGE_TYPES[path.extname(SOURCE_IMAGE).toLowerCase()] || 'image/jpeg';
        }
        imageReady = true;
        console.log('[LACAL] Source image loaded:', imageBuf.length, 'bytes');
    } catch (e) {
        console.error('[LACAL] Failed to load source image:', e.message);
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        if (url.pathname === '/' || url.pathname === '/index.html') {
            const hitIp = getClientIp(req);
            const hitDevice = uaSummary(req.headers['user-agent'] || '');
            const { geo } = await geoLookup(hitIp);
            logHit('index', req, hitIp, geo, hitDevice);
            const page = htmlPage(hitIp, geo, hitDevice, 'index');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(page);
        }

        const m = url.pathname.match(/^\/lacak\/([a-f0-9]+)\.(jpg|jpeg|png|webp)$/i);
        if (!m) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('not found');
        }

        const ip = getClientIp(req);
        const device = uaSummary(req.headers['user-agent'] || '');
        const { geo } = await geoLookup(ip);
        logHit(m[1], req, ip, geo, device);

        if (!imageReady) {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            return res.end('image not ready');
        }

        const mime = IMAGE_TYPES['.' + m[2].toLowerCase()] || imageType;
        const out = await renderImage(ip, m[1], geo, device);
        if (req.method === 'HEAD') {
            res.writeHead(200, { 'Content-Type': mime, 'Content-Length': out.length });
            return res.end();
        }

        res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': out.length,
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(out);
    });

    server.listen(PORT, HOST, () => {
        console.log(`[LACAL] Tracker running on ${HOST}:${PORT}`);
        console.log(`[LACAL] Log file: ${LOG_FILE}`);
        console.log(`[LACAL] Sharp overlay: ${sharp ? 'active' : 'unavailable (plain image)'}`);
    });
}

start();