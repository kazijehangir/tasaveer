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

// ExifTool configuration
// Windows uses standalone exe, macOS/Linux use Perl distribution
// Downloads from SourceForge (official distribution)
const EXIFTOOL_VERSION = '13.59';
const EXIFTOOL_MAPPINGS = {
    'windows': {
        targetTriple: 'x86_64-pc-windows-msvc',
        extension: '.exe',
        // Windows exe is a standalone binary with bundled Perl
        url: `https://sourceforge.net/projects/exiftool/files/exiftool-${EXIFTOOL_VERSION}_64.zip/download`,
        extract: 'zip',
        binaryInArchive: 'exiftool(-k).exe'
    },
    'darwin-x64': {
        targetTriple: 'x86_64-apple-darwin',
        extension: '',
        // macOS/Linux use the Perl distribution
        url: `https://sourceforge.net/projects/exiftool/files/Image-ExifTool-${EXIFTOOL_VERSION}.tar.gz/download`,
        extract: 'tar.gz',
        perlBundle: true
    },
    'darwin-arm64': {
        targetTriple: 'aarch64-apple-darwin',
        extension: '',
        url: `https://sourceforge.net/projects/exiftool/files/Image-ExifTool-${EXIFTOOL_VERSION}.tar.gz/download`,
        extract: 'tar.gz',
        perlBundle: true
    },
    'linux-x64': {
        targetTriple: 'x86_64-unknown-linux-gnu',
        extension: '',
        url: `https://sourceforge.net/projects/exiftool/files/Image-ExifTool-${EXIFTOOL_VERSION}.tar.gz/download`,
        extract: 'tar.gz',
        perlBundle: true
    }
};

// Czkawka configuration
// Downloads precompiled binaries from GitHub releases
const CZKAWKA_VERSION = '11.0.1';
const CZKAWKA_MAPPINGS = {
    'windows_czkawka_cli.exe': {
        targetTriple: 'x86_64-pc-windows-msvc',
        extension: '.exe'
    },
    'mac_czkawka_cli_x86_64': {
        targetTriple: 'x86_64-apple-darwin',
        extension: ''
    },
    'mac_czkawka_cli_arm64': {
        targetTriple: 'aarch64-apple-darwin',
        extension: ''
    },
    'linux_czkawka_cli_x86_64': {
        targetTriple: 'x86_64-unknown-linux-gnu',
        extension: ''
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

        try {
            const outputName = `immich-go-${config.targetTriple}${config.extension}`;
            const outputPath = path.join(BINARIES_DIR, outputName);

            // Check if already exists
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
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
        } catch (err) {
            console.error(`   ❌ Failed to download immich-go for ${config.targetTriple}:`, err.message);
            // Only throw error if it is critical for the current platform/macos build
            const currentTriple = getCurrentTargetTriple();
            const isMacosBuild = process.argv.includes('--macos');
            if (config.targetTriple === currentTriple || (isMacosBuild && config.targetTriple.includes('apple-darwin'))) {
                throw err;
            }
        }
    }
}

// Get ExifTool config for a target triple
function getExifToolConfig(targetTriple) {
    if (targetTriple === 'x86_64-pc-windows-msvc') {
        return EXIFTOOL_MAPPINGS['windows'];
    }
    if (targetTriple === 'x86_64-apple-darwin') {
        return EXIFTOOL_MAPPINGS['darwin-x64'];
    }
    if (targetTriple === 'aarch64-apple-darwin') {
        return EXIFTOOL_MAPPINGS['darwin-arm64'];
    }
    if (targetTriple === 'x86_64-unknown-linux-gnu') {
        return EXIFTOOL_MAPPINGS['linux-x64'];
    }
    return null;
}

function findFileRecursive(dir, predicate) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            const found = findFileRecursive(fullPath, predicate);
            if (found) return found;
        } else if (predicate(file)) {
            return fullPath;
        }
    }
    return null;
}

async function downloadExifTool(targetTriples) {
    console.log(`📦 Downloading ExifTool v${EXIFTOOL_VERSION}...`);

    for (const targetTriple of targetTriples) {
        const config = getExifToolConfig(targetTriple);
        if (!config) {
            console.warn(`   ⚠ No ExifTool config for target: ${targetTriple}`);
            continue;
        }

        try {
            const outputName = `exiftool-${config.targetTriple}${config.extension}`;
            const outputPath = path.join(BINARIES_DIR, outputName);

            // Check if already exists
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                console.log(`   ✓ ${outputName} already exists, skipping`);
                continue;
            }

            console.log(`   ⬇ Downloading ExifTool for ${targetTriple}...`);

            const archiveExt = config.extract === 'zip' ? '.zip' : '.tar.gz';
            const archivePath = path.join(BINARIES_DIR, `exiftool-${targetTriple}${archiveExt}`);

            await downloadFile(config.url, archivePath);

            console.log(`   📂 Extracting...`);

            const tempDir = path.join(BINARIES_DIR, `_temp_exiftool_${targetTriple}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            try {
                if (config.extract === 'zip') {
                    // Windows: extract and find the exe
                    if (process.platform === 'win32') {
                        execSync(`powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tempDir}' -Force"`, { stdio: 'inherit' });
                    } else {
                        execSync(`unzip -o "${archivePath}" -d "${tempDir}"`, { stdio: 'inherit' });
                        execSync(`chmod -R +w "${tempDir}"`);
                    }

                    // Find exiftool(-k).exe and rename it
                    const exeFilePath = findFileRecursive(tempDir, (f) => f.includes('exiftool') && f.endsWith('.exe'));
                    if (exeFilePath) {
                        fs.copyFileSync(exeFilePath, outputPath);
                    } else {
                        throw new Error('ExifTool exe not found in archive');
                    }
                } else {
                    // macOS/Linux: Perl distribution
                    execSync(`tar -xzf "${archivePath}" -C "${tempDir}"`, { stdio: 'inherit' });

                    // Find the extracted directory (Image-ExifTool-X.XX)
                    const files = fs.readdirSync(tempDir);
                    const exifToolDir = files.find(f => f.startsWith('Image-ExifTool'));

                    if (!exifToolDir) {
                        throw new Error('ExifTool directory not found in archive');
                    }

                    const exifToolPath = path.join(tempDir, exifToolDir);

                    if (config.perlBundle) {
                        // Create a self-contained directory with the Perl scripts
                        const bundleDir = path.join(BINARIES_DIR, `exiftool-bundle-${targetTriple}`);
                        if (fs.existsSync(bundleDir)) {
                            fs.rmSync(bundleDir, { recursive: true, force: true });
                        }
                        fs.mkdirSync(bundleDir, { recursive: true });

                        // Copy exiftool script and lib directory
                        fs.copyFileSync(path.join(exifToolPath, 'exiftool'), path.join(bundleDir, 'exiftool'));

                        // Copy lib directory recursively
                        const libSrc = path.join(exifToolPath, 'lib');
                        const libDest = path.join(bundleDir, 'lib');
                        execSync(`cp -r "${libSrc}" "${libDest}"`, { stdio: 'inherit' });

                        // Create a wrapper script
                        const wrapperContent = `#!/bin/sh
# ExifTool wrapper script for Tasaveer
# This script invokes the Perl exiftool from the bundle directory

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_DIR="${'${'}SCRIPT_DIR}/exiftool-bundle-${targetTriple}"
exec perl "${'${'}BUNDLE_DIR}/exiftool" "$@"
`;
                        fs.writeFileSync(outputPath, wrapperContent);
                        fs.chmodSync(outputPath, 0o755);
                    }
                }

                console.log(`   ✓ ${outputName} ready`);
            } finally {
                // Cleanup
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (rmErr) {
                    try {
                        if (process.platform !== 'win32') {
                            execSync(`rm -rf "${tempDir}"`);
                        }
                    } catch (e) {}
                }
                if (fs.existsSync(archivePath)) {
                    fs.unlinkSync(archivePath);
                }
            }
        } catch (err) {
            console.error(`   ❌ Failed to download ExifTool for ${targetTriple}:`, err.message);
            // Only throw error if it is critical for the current platform/macos build
            const currentTriple = getCurrentTargetTriple();
            const isMacosBuild = process.argv.includes('--macos');
            if (targetTriple === currentTriple || (isMacosBuild && targetTriple.includes('apple-darwin'))) {
                throw err;
            }
        }
    }
}

async function downloadCzkawka(targetTriples) {
    console.log(`📦 Downloading Czkawka CLI v${CZKAWKA_VERSION}...`);

    for (const [assetName, config] of Object.entries(CZKAWKA_MAPPINGS)) {
        if (!targetTriples.includes(config.targetTriple)) {
            continue;
        }

        try {
            const outputName = `czkawka_cli-${config.targetTriple}${config.extension}`;
            const outputPath = path.join(BINARIES_DIR, outputName);

            // Check if already exists
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                console.log(`   ✓ ${outputName} already exists, skipping`);
                continue;
            }

            console.log(`   ⬇ Downloading ${assetName}...`);

            const url = `https://github.com/qarmin/czkawka/releases/download/${CZKAWKA_VERSION}/${assetName}`;
            await downloadFile(url, outputPath);

            // Make executable on Unix
            if (process.platform !== 'win32') {
                fs.chmodSync(outputPath, 0o755);
            }

            console.log(`   ✓ ${outputName} ready`);
        } catch (err) {
            console.error(`   ❌ Failed to download Czkawka for ${config.targetTriple}:`, err.message);
            // Only throw error if it is critical for the current platform/macos build
            const currentTriple = getCurrentTargetTriple();
            const isMacosBuild = process.argv.includes('--macos');
            if (config.targetTriple === currentTriple || (isMacosBuild && config.targetTriple.includes('apple-darwin'))) {
                throw err;
            }
        }
    }
}

async function main() {
    const downloadAll = process.argv.includes('--all');
    const downloadMacos = process.argv.includes('--macos');

    console.log('🚀 Tasaveer Binary Downloader\n');

    // Ensure binaries directory exists
    if (!fs.existsSync(BINARIES_DIR)) {
        fs.mkdirSync(BINARIES_DIR, { recursive: true });
    }

    let targetTriples;

    if (downloadAll) {
        console.log('📋 Mode: Download all platforms\n');
        // Get unique target triples from both mappings
        const immichGoTriples = Object.values(IMMICH_GO_MAPPINGS).map(m => m.targetTriple);
        const exifToolTriples = Object.values(EXIFTOOL_MAPPINGS).map(m => m.targetTriple);
        const czkawkaTriples = Object.values(CZKAWKA_MAPPINGS).map(m => m.targetTriple);
        targetTriples = [...new Set([...immichGoTriples, ...exifToolTriples, ...czkawkaTriples])];
    } else if (downloadMacos) {
        console.log('📋 Mode: Download macOS platforms only\n');
        targetTriples = ['x86_64-apple-darwin', 'aarch64-apple-darwin'];
    } else {
        const currentTriple = getCurrentTargetTriple();
        console.log(`📋 Mode: Current platform (${currentTriple})\n`);
        targetTriples = [currentTriple];
    }

    await downloadImmichGo(targetTriples);
    await downloadExifTool(targetTriples);
    await downloadCzkawka(targetTriples);

    console.log('\n✅ Done!');
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
