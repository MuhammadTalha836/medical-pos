import { prisma } from '../database/prisma';
import { DeveloperKeyMissingError, getDeveloperSecret } from './developerKey';
import { verifyTotpStep } from './totp';

const LAST_STEP_KEY = 'developer_totp_last_step';

export type DeveloperCodeResult = 'ok' | 'invalid' | 'replayed' | 'not_configured';

/**
 * Checks a 6-digit code against the developer master key (±30 s drift). A code is accepted once:
 * the matched time step is stored and older or equal steps are rejected afterwards.
 */
export async function verifyDeveloperCode(code: string): Promise<DeveloperCodeResult> {
  let secret: string;
  try {
    secret = getDeveloperSecret();
  } catch (error) {
    if (error instanceof DeveloperKeyMissingError) return 'not_configured';
    throw error;
  }

  const step = verifyTotpStep(secret, String(code ?? '').trim(), 1);
  if (step === null) return 'invalid';

  const row = await prisma.systemSetting.findUnique({ where: { key: LAST_STEP_KEY } });
  if (step <= Number(row?.value || 0)) return 'replayed';

  await prisma.systemSetting.upsert({
    where: { key: LAST_STEP_KEY },
    update: { value: String(step) },
    create: { key: LAST_STEP_KEY, value: String(step) }
  });
  return 'ok';
}

export const DEVELOPER_CODE_ERRORS: Record<Exclude<DeveloperCodeResult, 'ok'>, string> = {
  invalid: 'Invalid verification code. Check the developer authenticator app and try again.',
  replayed: 'This code was already used. Wait for the next code in the authenticator app.',
  not_configured: 'Developer master key is not configured in this build. Run "npm run developer:key" and rebuild.'
};

export const DEVELOPER_TOTP_STATE_KEYS = [LAST_STEP_KEY];
