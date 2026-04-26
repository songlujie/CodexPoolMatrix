import { spawn } from 'node:child_process';
import path from 'node:path';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function notarizeMacApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE?.trim();
  const appleId = process.env.APPLE_ID?.trim();
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim();
  const teamId = process.env.APPLE_TEAM_ID?.trim();

  if (keychainProfile) {
    console.log(`[notarize] submitting ${appName}.app with keychain profile ${keychainProfile}`);
    await run('xcrun', ['notarytool', 'submit', appPath, '--keychain-profile', keychainProfile, '--wait']);
  } else if (appleId && appleIdPassword && teamId) {
    console.log(`[notarize] submitting ${appName}.app with Apple ID credentials`);
    await run('xcrun', [
      'notarytool',
      'submit',
      appPath,
      '--apple-id',
      appleId,
      '--password',
      appleIdPassword,
      '--team-id',
      teamId,
      '--wait',
    ]);
  } else {
    console.log('[notarize] skipped: APPLE_KEYCHAIN_PROFILE or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID not configured');
    return;
  }

  await run('xcrun', ['stapler', 'staple', appPath]);
  console.log(`[notarize] stapled ${appName}.app`);
}

export default notarizeMacApp;
