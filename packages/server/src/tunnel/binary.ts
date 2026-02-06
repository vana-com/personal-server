/**
 * On-demand frpc binary download and version management.
 *
 * Downloads the correct frpc binary for the current platform from GitHub
 * releases, stores it in the user's data directory, and re-downloads only
 * when the pinned version changes.
 */

import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
  constants,
} from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** Pinned frpc version — bump this to trigger re-download on next startup. */
export const FRPC_VERSION = "0.67.0";

const GITHUB_RELEASE_BASE = "https://github.com/fatedier/frp/releases/download";

export interface PlatformInfo {
  /** e.g. "darwin_arm64" */
  name: string;
  /** Archive extension: "tar.gz" or "zip" */
  ext: "tar.gz" | "zip";
  /** Binary file name inside the archive */
  binaryName: string;
}

interface VersionMetadata {
  version: string;
  platform: string;
  installedAt: string;
}

/**
 * Map current process.platform / process.arch to frp release naming.
 */
export function getPlatformInfo(): PlatformInfo {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    const archName = arch === "arm64" ? "arm64" : "amd64";
    return {
      name: `darwin_${archName}`,
      ext: "tar.gz",
      binaryName: "frpc",
    };
  }

  if (platform === "linux") {
    const archName = arch === "arm64" ? "arm64" : "amd64";
    return {
      name: `linux_${archName}`,
      ext: "tar.gz",
      binaryName: "frpc",
    };
  }

  if (platform === "win32") {
    return {
      name: "windows_amd64",
      ext: "zip",
      binaryName: "frpc.exe",
    };
  }

  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

/**
 * Return the expected path to the frpc binary under storageRoot.
 */
export function getBinaryPath(storageRoot: string): string {
  const isWindows = process.platform === "win32";
  return join(storageRoot, "bin", isWindows ? "frpc.exe" : "frpc");
}

function versionFilePath(storageRoot: string): string {
  return join(storageRoot, "bin", "frpc-version.json");
}

/**
 * Read the installed version from the metadata file.
 * Returns null if the file is missing or corrupt.
 */
export async function getInstalledVersion(
  storageRoot: string,
): Promise<string | null> {
  try {
    const raw = await readFile(versionFilePath(storageRoot), "utf-8");
    const meta: VersionMetadata = JSON.parse(raw);
    return meta.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Write version metadata after successful installation.
 */
export async function writeVersionFile(
  storageRoot: string,
  version: string,
): Promise<void> {
  const meta: VersionMetadata = {
    version,
    platform: `${process.platform}_${process.arch}`,
    installedAt: new Date().toISOString(),
  };
  await writeFile(versionFilePath(storageRoot), JSON.stringify(meta, null, 2));
}

/**
 * Build the GitHub release download URL for a given version and platform.
 */
export function getDownloadUrl(
  version: string,
  platformInfo: PlatformInfo,
): string {
  const archiveName = `frp_${version}_${platformInfo.name}.${platformInfo.ext}`;
  return `${GITHUB_RELEASE_BASE}/v${version}/${archiveName}`;
}

/**
 * Download a file from `url` to `destPath` using fetch + stream pipeline.
 */
export async function downloadArchive(
  url: string,
  destPath: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download frpc: HTTP ${response.status} from ${url}`,
    );
  }
  if (!response.body) {
    throw new Error("No response body received");
  }

  const fileStream = createWriteStream(destPath);
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    fileStream,
  );
}

/**
 * Extract the frpc binary from a downloaded archive into destDir.
 */
export async function extractBinary(
  archivePath: string,
  destDir: string,
  version: string,
  platformInfo: PlatformInfo,
): Promise<string> {
  const extractDir = join(destDir, "_extract");
  await mkdir(extractDir, { recursive: true });

  try {
    if (platformInfo.ext === "tar.gz") {
      await execAsync(`tar -xzf "${archivePath}" -C "${extractDir}"`);
    } else {
      // Windows: use PowerShell
      await execAsync(
        `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`,
      );
    }

    // The archive extracts to frp_<version>_<platform>/frpc
    const innerDir = join(extractDir, `frp_${version}_${platformInfo.name}`);
    const srcBinary = join(innerDir, platformInfo.binaryName);

    // Verify extracted binary exists
    await access(srcBinary, constants.F_OK);

    // Move binary to final destination
    const finalPath = join(destDir, platformInfo.binaryName);
    await rename(srcBinary, finalPath);

    return finalPath;
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}

export interface EnsureFrpcOptions {
  log?: (msg: string) => void;
}

/**
 * Main entry point: ensure the correct frpc binary is available.
 *
 * 1. Check version file — if version matches and binary exists, return path (fast path).
 * 2. Otherwise download, extract, chmod, write version file, return path.
 */
export async function ensureFrpcBinary(
  storageRoot: string,
  options?: EnsureFrpcOptions,
): Promise<string> {
  const log = options?.log ?? (() => {});
  const binDir = join(storageRoot, "bin");
  const binaryPath = getBinaryPath(storageRoot);

  // Fast path: version matches and binary exists
  const installedVersion = await getInstalledVersion(storageRoot);
  if (installedVersion === FRPC_VERSION) {
    try {
      await access(binaryPath, constants.F_OK);
      log(`frpc v${FRPC_VERSION} already installed`);
      return binaryPath;
    } catch {
      // Binary missing despite version file — re-download
    }
  }

  // Need to download
  log(`Downloading frpc v${FRPC_VERSION}...`);
  await mkdir(binDir, { recursive: true });

  const platformInfo = getPlatformInfo();
  const url = getDownloadUrl(FRPC_VERSION, platformInfo);

  // Download to a temp file in the bin directory
  const tempArchive = join(binDir, `_frpc_download.${platformInfo.ext}`);

  try {
    await downloadArchive(url, tempArchive);
    log("Download complete, extracting...");

    await extractBinary(tempArchive, binDir, FRPC_VERSION, platformInfo);

    // Make executable on unix
    if (process.platform !== "win32") {
      await chmod(binaryPath, 0o755);
    }

    await writeVersionFile(storageRoot, FRPC_VERSION);
    log(`frpc v${FRPC_VERSION} installed successfully`);

    return binaryPath;
  } finally {
    // Clean up temp archive
    await rm(tempArchive, { force: true });
  }
}
