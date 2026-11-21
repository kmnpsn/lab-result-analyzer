#!/usr/bin/env node
/**
 * wrangler.jsonc の database_id をリポジトリやチャットログに残さず、
 * 環境変数または ~/.config/lab-result-analyzer/cloudflare.env から実行時のみ注入して
 * wrangler コマンドを実行するラッパー。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rootDir = process.cwd();
const configEnvPath =
  process.env.CF_CONFIG_ENV_FILE ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'lab-result-analyzer', 'cloudflare.env');

function loadEnvFile(filePath) {
  const loaded = {};
  if (!fs.existsSync(filePath)) return loaded;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    if ( val.startsWith("$'") && val.endsWith("'") ) {
      val = val.slice(2, -1);
    }
    loaded[key] = val;
  }
  return loaded;
}

const fileVars = loadEnvFile(configEnvPath);
const mergedEnv = { ...fileVars, ...process.env };
const dbId = (mergedEnv.CF_D1_DATABASE_ID || '').trim();

const wranglerArgs = process.argv.slice(2);
if (wranglerArgs.length === 0) {
  console.error('Usage: node scripts/run-wrangler.mjs <wrangler-args...>');
  process.exit(2);
}

const isLocalOnly = wranglerArgs.includes('--local');
if (!dbId && !isLocalOnly) {
  console.error(
    'CF_D1_DATABASE_ID が未設定です。`npm run cf:config` を実行するか、環境変数 / GitHub Secrets に CF_D1_DATABASE_ID を設定してください。'
  );
  process.exit(1);
}

const baseConfigPath = path.join(rootDir, 'wrangler.jsonc');
const tempConfigPath = path.join(rootDir, '.wrangler.deploy.jsonc');

try {
  const rawConfig = fs.readFileSync(baseConfigPath, 'utf-8');
  const effectiveConfig = dbId
    ? rawConfig.replace('00000000-0000-0000-0000-000000000000', dbId)
    : rawConfig;

  fs.writeFileSync(tempConfigPath, effectiveConfig, { mode: 0o600 });

  const result = spawnSync('npx', ['wrangler', '--config', tempConfigPath, ...wranglerArgs], {
    stdio: 'inherit',
    env: mergedEnv,
  });

  process.exit(result.status ?? 1);
} finally {
  if (fs.existsSync(tempConfigPath)) {
    try {
      fs.unlinkSync(tempConfigPath);
    } catch {
      // ignore cleanup error
    }
  }
}
