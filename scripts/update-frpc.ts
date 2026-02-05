/**
 * Downloads the latest frpc binaries from GitHub releases.
 *
 * Usage: pnpm run update-frpc
 */

import { mkdir, rm, chmod, copyFile } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";

const execAsync = promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);
const BIN_DIR = join(PROJECT_ROOT, "packages", "server", "bin");

const PLATFORMS = [
  { name: "darwin_amd64", ext: "tar.gz" },
  { name: "darwin_arm64", ext: "tar.gz" },
  { name: "linux_amd64", ext: "tar.gz" },
  { name: "windows_amd64", ext: "zip" },
] as const;

interface GitHubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

async function getLatestRelease(): Promise<{
  version: string;
  assets: Map<string, string>;
}> {
  const response = await fetch(
    "https://api.github.com/repos/fatedier/frp/releases/latest",
  );
  if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

  const release: GitHubRelease = await response.json();
  const version = release.tag_name.replace(/^v/, "");

  const assets = new Map<string, string>();
  for (const asset of release.assets) {
    assets.set(asset.name, asset.browser_download_url);
  }

  return { version, assets };
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  if (!response.body) throw new Error("No response body");

  const fileStream = createWriteStream(dest);
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    fileStream,
  );
}

async function main() {
  console.log("Fetching latest FRP release...");
  const { version, assets } = await getLatestRelease();
  console.log(`Latest version: v${version}`);

  const tempDir = join(PROJECT_ROOT, ".frp-download");
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(BIN_DIR, { recursive: true });

  try {
    for (const platform of PLATFORMS) {
      const archiveName = `frp_${version}_${platform.name}.${platform.ext}`;
      const url = assets.get(archiveName);

      if (!url) {
        console.warn(`  Warning: ${archiveName} not found in release`);
        continue;
      }

      console.log(`  Downloading ${platform.name}...`);
      const archivePath = join(tempDir, archiveName);
      await downloadFile(url, archivePath);

      // Extract using system tools
      if (platform.ext === "tar.gz") {
        await execAsync(`tar -xzf "${archivePath}" -C "${tempDir}"`);
      } else {
        await execAsync(`unzip -q -o "${archivePath}" -d "${tempDir}"`);
      }

      // Copy binary
      const extractDir = join(tempDir, `frp_${version}_${platform.name}`);
      const isWindows = platform.name.includes("windows");
      const srcBinary = join(extractDir, isWindows ? "frpc.exe" : "frpc");
      const destBinary = join(
        BIN_DIR,
        `frpc_${platform.name}${isWindows ? ".exe" : ""}`,
      );

      await copyFile(srcBinary, destBinary);
      if (!isWindows) {
        await chmod(destBinary, 0o755);
      }

      console.log(`    -> frpc_${platform.name}${isWindows ? ".exe" : ""}`);
    }

    // Remove placeholder if present
    const gitkeep = join(BIN_DIR, ".gitkeep");
    if (existsSync(gitkeep)) {
      await rm(gitkeep);
    }

    console.log(
      `\nDone! frpc v${version} binaries installed to packages/server/bin/`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
