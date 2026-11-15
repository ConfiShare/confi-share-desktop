#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const isDev = process.argv.includes('--dev');
const requiredEntitlementKeys = [
  'com.apple.security.app-sandbox',
  'com.apple.security.cs.allow-jit',
  'com.apple.security.network.client',
  'com.apple.security.files.user-selected.read-only',
];

function ok(message) {
  console.log(`[mas-preflight] OK   ${message}`);
}

function warn(message) {
  console.warn(`[mas-preflight] WARN ${message}`);
}

function fail(message) {
  console.error(`[mas-preflight] FAIL ${message}`);
  process.exit(1);
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

console.log(`[mas-preflight] Checking ${isDev ? 'mas-dev (local sandbox test)' : 'mas (App Store distribution)'} prerequisites...`);

if (process.platform !== 'darwin') {
  fail('Mac App Store packages can only be built on macOS. Run this in the macOS CI job or on a Mac.');
}

const configPath = path.join(root, 'electron-builder-mas.json5');
const appEntitlementsPath = path.join(root, 'build', 'entitlements.mas.plist');
const inheritEntitlementsPath = path.join(root, 'build', 'entitlements.mas.inherit.plist');
const profilePath = path.join(
  root,
  process.env.MAS_PROVISIONING_PROFILE || (isDev ? 'build/embedded.dev.provisionprofile' : 'build/embedded.provisionprofile'),
);

for (const file of [configPath, appEntitlementsPath, inheritEntitlementsPath]) {
  if (!fs.existsSync(file)) fail(`Missing required file: ${path.relative(root, file)}`);
  ok(`Found ${path.relative(root, file)}`);
}

const appEntitlements = fs.readFileSync(appEntitlementsPath, 'utf8');
for (const key of requiredEntitlementKeys) {
  if (!appEntitlements.includes(`<key>${key}</key>`)) {
    fail(`build/entitlements.mas.plist is missing ${key}`);
  }
}
if (appEntitlements.includes('com.apple.security.cs.disable-library-validation')) {
  fail('build/entitlements.mas.plist contains disable-library-validation; do not reuse the Developer ID entitlements.');
}
if (appEntitlements.includes('com.apple.security.cs.allow-unsigned-executable-memory')) {
  fail('build/entitlements.mas.plist contains allow-unsigned-executable-memory; use only allow-jit for MAS.');
}
ok('MAS app entitlements contain sandbox, JIT, network client, and user-selected file access.');

const inheritEntitlements = fs.readFileSync(inheritEntitlementsPath, 'utf8');
for (const key of ['com.apple.security.app-sandbox', 'com.apple.security.inherit']) {
  if (!inheritEntitlements.includes(`<key>${key}</key>`)) {
    fail(`build/entitlements.mas.inherit.plist is missing ${key}`);
  }
}
ok('MAS helper entitlements contain app-sandbox and inherit.');

if (!fs.existsSync(profilePath)) {
  fail(
    `Missing provisioning profile: ${path.relative(root, profilePath)}\n` +
      (isDev
        ? 'Create a Mac App Development profile for com.confishare.desktop and save it as build/embedded.dev.provisionprofile.'
        : 'Create a Mac App Store distribution profile for com.confishare.desktop and save it as build/embedded.provisionprofile, or set MAS_PROVISIONING_PROFILE to its path.'),
  );
}
ok(`Found provisioning profile ${path.relative(root, profilePath)}`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confishare-mas-preflight-'));
const profilePlistPath = path.join(tmpDir, 'profile.plist');
try {
  const profileXml = run('security', ['cms', '-D', '-i', profilePath]);
  fs.writeFileSync(profilePlistPath, profileXml);

  if (!profileXml.includes('com.confishare.desktop')) {
    fail('The provisioning profile does not contain com.confishare.desktop.');
  }
  ok('Provisioning profile is for com.confishare.desktop.');

  try {
    const expiration = run('/usr/libexec/PlistBuddy', ['-c', 'Print :ExpirationDate', profilePlistPath]).trim();
    const expiresAt = Date.parse(expiration);
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      fail(`Provisioning profile expired at ${expiration}.`);
    }
    ok(`Provisioning profile expiration: ${expiration || 'unknown'}`);
  } catch {
    warn('Could not read the provisioning profile expiration date.');
  }

  if (profileXml.includes('<key>get-task-allow</key>') && profileXml.includes('<true/>') && !isDev) {
    warn('The distribution profile appears to include get-task-allow=true. Verify you selected a Mac App Store distribution profile.');
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const usesImportedP12 = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
if (usesImportedP12) {
  ok('CSC_LINK/CSC_NAME is set; electron-builder will import/use the MAS signing identity.');
  if (!process.env.CSC_KEY_PASSWORD) {
    warn('CSC_KEY_PASSWORD is not set. This is only okay if the imported keychain identity has no password.');
  }

  if (!isDev) {
    if (process.env.CSC_INSTALLER_LINK) {
      ok('CSC_INSTALLER_LINK is set; electron-builder will import/use the Mac Installer Distribution identity.');
      if (!process.env.CSC_INSTALLER_KEY_PASSWORD) {
        warn('CSC_INSTALLER_KEY_PASSWORD is not set. This is only okay if the installer key has no password.');
      }
    } else if (!process.env.CSC_NAME) {
      warn(
        'CSC_INSTALLER_LINK is not set. The Mac Installer Distribution identity must already be in the keychain or included in CSC_LINK; otherwise .pkg signing will fail.',
      );
    }
  }
} else {
  const identities = run('security', ['find-identity', '-v']);
  if (isDev) {
    const hasDevelopment =
      identities.includes('Apple Development') || identities.includes('Mac Developer');
    if (!hasDevelopment) {
      fail('No Apple Development/Mac Developer signing identity found in the keychain.');
    }
    ok('Found an Apple Development/Mac Developer signing identity for mas-dev.');
  } else {
    const hasApp =
      identities.includes('3rd Party Mac Developer Application') || identities.includes('Apple Distribution');
    const hasInstaller =
      identities.includes('3rd Party Mac Developer Installer') || identities.includes('Mac Installer Distribution');
    if (!hasApp) {
      fail('No Mac App Distribution / Apple Distribution signing identity found in the keychain.');
    }
    if (!hasInstaller) {
      fail('No Mac Installer Distribution / 3rd Party Mac Developer Installer signing identity found in the keychain.');
    }
    ok('Found both Mac App Distribution and Mac Installer Distribution identities.');
  }
}

console.log('[mas-preflight] All checks passed.');
console.log(
  isDev
    ? '[mas-preflight] Next: npm run build:mas:dev, then launch release-mas/<version>/mas-dev-universal/ConfiShare.app and run docs/MAS_TEST_PLAN.md.'
    : '[mas-preflight] Next: npm run build:mas, then npm run validate:mas before uploading the .pkg with Transporter.',
);
