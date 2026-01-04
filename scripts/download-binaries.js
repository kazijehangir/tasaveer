/**
 * Download platform-specific binaries for Tasaveer
 * 
 * This script fetches the latest releases of immich-go from GitHub
 * and renames them to match Tauri's sidecar naming convention.
 * 
 * Usage:
 *   node scripts/download-binaries.js [--all]
 * 
 * Options:
 *   --all    Download binaries for all platforms (for CI builds)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BINARIES_DIR = path.join(__dirname, '..', 'src-tauri', 'binaries');

// immich-go release mappings
// Maps GitHub release asset names to Tauri target triples
const IMMICH_GO_MAPPINGS = {
    'immich-go_Windows_x86_64.zip': {
        targetTriple: 'x86_64-pc-windows-msvc',
        extension: '.exe',
        extract: 'zip'
    },
    'immich-go_Darwin_x86_64.tar.gz': {
        targetTriple: 'x86_64-apple-darwin',
        extension: '',
        extract: 'tar.gz'
    },
    'immich-go_Darwin_arm64.tar.gz': {
        targetTriple: 'aarch64-apple-darwin',
        extension: '',
        extract: 'tar.gz'
    },
    'immich-go_Linux_x86_64.tar.gz': {
        targetTriple: 'x86_64-unknown-linux-gnu',
        extension: '',
        extract: 'tar.gz'
    }
};

// Get current platform's target triple
function getCurrentTargetTriple() {
    try {
        const rustInfo = execSync('rustc -Vv', { encoding: 'utf-8' });
        const match = /host: (\S+)/.exec(rustInfo);
        if (match) {
            return match[1];
        }
    } catch (e) {
        console.error('Warning: Could not determine target triple from rustc');
    }

    // Fallback based on platform
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
    if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
    if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
    if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';

    throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

// Fetch JSON from URL
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Tasaveer-Downloader' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchJson(res.headers.location).then(resolve).catch(reject);
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Failed to parse JSON: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

// Download file to path
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);

        const request = (url) => {
            https.get(url, { headers: { 'User-Agent': 'Tasaveer-Downloader' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return request(res.headers.location);
                }

                if (res.statusCode !== 200) {
                    reject(new Error(`Download failed with status ${res.statusCode}`));
                    return;
                }

                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(destPath, () => { }); // Delete partial file
                reject(err);
            });
        };

        request(url);
    });
}

// Extract archive and get binary
async function extractBinary(archivePath, extractType, binaryName, outputPath) {
    const tempDir = path.join(BINARIES_DIR, '_temp');

    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
        if (extractType === 'zip') {
            // Use PowerShell on Windows
            if (process.platform === 'win32') {
                execSync(`powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tempDir}' -Force"`, { stdio: 'inherit' });
            } else {
                execSync(`unzip -o "${archivePath}" -d "${tempDir}"`, { stdio: 'inherit' });
            }
        } else if (extractType === 'tar.gz') {
            execSync(`tar -xzf "${archivePath}" -C "${tempDir}"`, { stdio: 'inherit' });
        }

        // Find the binary in extracted files
        const files = fs.readdirSync(tempDir);
        const binaryFile = files.find(f => f.startsWith('immich-go'));

        if (binaryFile) {
            const extractedPath = path.join(tempDir, binaryFile);
            fs.copyFileSync(extractedPath, outputPath);

            // Make executable on Unix
            if (process.platform !== 'win32') {
                fs.chmodSync(outputPath, 0o755);
            }
        } else {
            throw new Error(`Binary not found in archive: ${archivePath}`);
        }
    } finally {
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(archivePath);
    }
}

async function downloadImmichGo(targetTriples) {
    console.log('📦 Fetching latest immich-go release...');

    const releaseInfo = await fetchJson('https://api.github.com/repos/simulot/immich-go/releases/latest');
    const version = releaseInfo.tag_name;

    console.log(`   Found version: ${version}`);

    for (const [assetName, config] of Object.entries(IMMICH_GO_MAPPINGS)) {
        if (!targetTriples.includes(config.targetTriple)) {
            continue;
        }

        const outputName = `immich-go-${config.targetTriple}${config.extension}`;
        const outputPath = path.join(BINARIES_DIR, outputName);

        // Check if already exists
        if (fs.existsSync(outputPath)) {
            console.log(`   ✓ ${outputName} already exists, skipping`);
            continue;
        }

        const asset = releaseInfo.assets.find(a => a.name === assetName);
        if (!asset) {
            console.warn(`   ⚠ Asset not found: ${assetName}`);
            continue;
        }

        console.log(`   ⬇ Downloading ${assetName}...`);

        const archivePath = path.join(BINARIES_DIR, assetName);
        await downloadFile(asset.browser_download_url, archivePath);

        console.log(`   📂 Extracting to ${outputName}...`);
        await extractBinary(archivePath, config.extract, 'immich-go', outputPath);

        console.log(`   ✓ ${outputName} ready`);
    }
}

async function main() {
    const downloadAll = process.argv.includes('--all');

    console.log('🚀 Tasaveer Binary Downloader\n');

    // Ensure binaries directory exists
    if (!fs.existsSync(BINARIES_DIR)) {
        fs.mkdirSync(BINARIES_DIR, { recursive: true });
    }

    let targetTriples;

    if (downloadAll) {
        console.log('📋 Mode: Download all platforms\n');
        targetTriples = Object.values(IMMICH_GO_MAPPINGS).map(m => m.targetTriple);
    } else {
        const currentTriple = getCurrentTargetTriple();
        console.log(`📋 Mode: Current platform (${currentTriple})\n`);
        targetTriples = [currentTriple];
    }

    await downloadImmichGo(targetTriples);

    console.log('\n✅ Done!');
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
