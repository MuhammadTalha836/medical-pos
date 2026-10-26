import { Router, type Request, type Response } from 'express';
import { prisma } from '../database/prisma';
import { logSecurityAudit } from '../security/audit';
import { DEVELOPER_TOTP_STATE_KEYS } from '../security/developerAuth';
import { LICENSE_SETTING_KEYS } from '../security/license';
import { CLOUD_SETTING_KEYS } from '../backup/cloud/cloudBackup';
import { parseBody, settingsSchema } from '../validation/schemas';
import { DEFAULT_DEVELOPER_FOOTER, isValidPaperSize, isValidTemplate, normalizePaperSize, normalizeTemplate } from '../../shared/invoice';
import { DEFAULT_INVOICE_SETTINGS, DEFAULT_SETTINGS } from '../../shared/settingsDefaults';
import { DEVELOPER_INFO_PLACEMENTS, DEVELOPER_PROFILE_FIELDS, DEVELOPER_PROFILE_SETTING_KEYS, developerInfoFor } from '../../shared/developerProfile';
import { WHATSAPP_TEMPLATE_KEYS, WHATSAPP_TEMPLATE_MAX } from '../../shared/whatsapp';
import { getActingUser, hasRolePermission, sendError } from '../http/context';

// System settings
const router = Router();

// Shown on the login screen before anyone signs in; everything else needs a session
const PUBLIC_SETTING_KEYS = ['store_name', 'store_address', 'store_phone', 'currency_symbol'];
// Signed license, TOTP replay state and the Google Drive sign-in are never readable or writable through /api/settings
const INTERNAL_SETTING_KEYS = [...LICENSE_SETTING_KEYS, ...DEVELOPER_TOTP_STATE_KEYS, ...CLOUD_SETTING_KEYS];

router.get('/api/settings', async (req: Request, res: Response) => {
  try {
    const rows = await prisma.systemSetting.findMany();
    const settings: Record<string, string> = {
      max_bill_discount_pct: DEFAULT_SETTINGS.max_bill_discount_pct,
      ...DEFAULT_INVOICE_SETTINGS
    };
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    // Developer information is mandatory and cannot be disabled
    settings.show_developer_info = 'true';

    // Thermal-only invoices: never hand out legacy A4/A5 sizes or sheet templates
    settings.default_invoice_template = normalizeTemplate(settings.default_invoice_template);
    settings.invoice_paper_size = normalizePaperSize(settings.invoice_paper_size ?? settings.paper_width);
    settings.paper_width = settings.invoice_paper_size;
    if (!settings.developer_invoice_footer) {
      settings.developer_invoice_footer = DEFAULT_DEVELOPER_FOOTER;
    }

    // Store identity stays visible on receipts unless the Developer allows hiding it
    if (settings.allow_admin_hide_store_identity !== 'true') {
      settings.show_store_name = 'true';
      settings.show_store_address = 'true';
    }

    // Developer identity is only served through the protected developer endpoint
    delete settings.developer_email;
    for (const key of INTERNAL_SETTING_KEYS) delete settings[key];

    for (const key of DEVELOPER_PROFILE_SETTING_KEYS) {
      settings[key] ??= DEFAULT_SETTINGS[key];
    }

    if (!(await getActingUser(req))) {
      const publicSettings: Record<string, string> = Object.fromEntries(
        PUBLIC_SETTING_KEYS.filter(key => settings[key] !== undefined).map(key => [key, settings[key]])
      );
      // The login screen shows only the developer details chosen for it
      const loginPlacement = DEVELOPER_INFO_PLACEMENTS.find(p => p.key === 'login')!;
      publicSettings[loginPlacement.setting] = settings[loginPlacement.setting];
      for (const item of developerInfoFor(settings, 'login')) {
        publicSettings[DEVELOPER_PROFILE_FIELDS.find(f => f.key === item.key)!.setting] = item.value;
      }
      return res.json(publicSettings);
    }
    res.json(settings);
  } catch (error: unknown) {
    sendError(res, error);
  }
});

// Keys only the Developer may change through any settings endpoint
const DEVELOPER_ONLY_SETTING_KEYS = [
  'developer_invoice_footer',
  'show_developer_info',
  ...DEVELOPER_PROFILE_SETTING_KEYS,
  'allow_admin_create_cashier',
  'allow_admin_create_admin',
  'allow_admin_edit_store_identity',
  'allow_admin_hide_store_identity',
  'loyalty_feature_allowed',
  'backup_retention_limit',
  'backup_mode',
  'backup_frequency',
  'backup_scheduled_time',
  'backup_weekly_day',
  // Retired by Phase 4: automatic backups are switched off only through the Developer frequency
  'auto_backup_enabled',
  'auto_backup_interval_hours',
  // Backup run state is written only by the backup engine
  'last_backup_time',
  'last_backup_file',
  'last_backup_status',
  'last_backup_error',
  'last_backup_attempt_at',
  'last_backup_type'
];

router.post('/api/settings', async (req: Request, res: Response) => {
  try {
    const actingUser = await getActingUser(req);
    if (!actingUser || !(await hasRolePermission(actingUser.role, 'settings'))) {
      await logSecurityAudit({
        action: 'SETTINGS_UPDATE',
        module: 'SETTINGS',
        status: 'FAILED',
        details: 'Unauthorized attempt to modify system settings without settings permission',
        userId: actingUser?.id,
        userName: actingUser?.username
      });
      return res.status(403).json({ error: 'Access denied: settings permission required' });
    }

    if (!parseBody(settingsSchema, req.body, res)) return;
    const settings: Record<string, unknown> = { ...req.body };
    // Developer info is strictly mandatory
    settings.show_developer_info = 'true';
    // Setup lock and developer identity are only managed by the setup wizard / developer endpoint
    delete settings.setup_completed;
    delete settings.developer_email;
    for (const key of INTERNAL_SETTING_KEYS) delete settings[key];

    // Thermal-only invoices: reject A3/A4/A5 sizes and retired sheet templates
    if (settings.default_invoice_template !== undefined && !isValidTemplate(settings.default_invoice_template)) {
      return res.status(400).json({ error: 'Invalid invoice template. Allowed: classic, compact, detailed' });
    }
    if (settings.invoice_paper_size !== undefined && !isValidPaperSize(settings.invoice_paper_size)) {
      return res.status(400).json({ error: 'Invalid paper size. Only 58mm and 80mm thermal rolls are supported' });
    }
    if (settings.paper_width !== undefined && !isValidPaperSize(settings.paper_width)) {
      return res.status(400).json({ error: 'Invalid paper width. Only 58mm and 80mm thermal rolls are supported' });
    }
    for (const key of WHATSAPP_TEMPLATE_KEYS) {
      if (settings[key] !== undefined && String(settings[key]).length > WHATSAPP_TEMPLATE_MAX) {
        return res.status(400).json({ error: `WhatsApp messages can be at most ${WHATSAPP_TEMPLATE_MAX} characters.` });
      }
    }
    // invoice_paper_size is canonical; keep the legacy paper_width key in step with it
    if (settings.invoice_paper_size !== undefined) {
      settings.paper_width = settings.invoice_paper_size;
    } else if (settings.paper_width !== undefined) {
      settings.invoice_paper_size = settings.paper_width;
    }

    // Loyalty on/off: only with the loyalty permission, and switching it on needs the Developer's permission first
    if (settings.loyalty_enabled !== undefined) {
      const value = String(settings.loyalty_enabled);
      if (value !== 'true' && value !== 'false') return res.status(400).json({ error: "loyalty_enabled must be 'true' or 'false'" });
      if (!(await hasRolePermission(actingUser.role, 'can_manage_loyalty'))) {
        delete settings.loyalty_enabled;
      } else if (value === 'true') {
        const rows = await prisma.systemSetting.findMany({ where: { key: { in: ['loyalty_feature_allowed', 'loyalty_enabled'] } } });
        const current = Object.fromEntries(rows.map(r => [r.key, r.value]));
        if (current.loyalty_feature_allowed !== 'true') {
          if (current.loyalty_enabled !== 'true') return res.status(400).json({ error: 'Loyalty points are not available for this store.' });
          delete settings.loyalty_enabled;
        }
      }
    }

    // If acting user is NOT developer, protect developer-managed keys & store identity
    if (actingUser.role !== 'developer') {
      for (const key of DEVELOPER_ONLY_SETTING_KEYS) {
        delete settings[key];
      }

      const identityToggles = await prisma.systemSetting.findMany({
        where: { key: { in: ['allow_admin_edit_store_identity', 'allow_admin_hide_store_identity'] } }
      });
      const toggles: Record<string, string> = {};
      for (const row of identityToggles) toggles[row.key] = row.value;

      if (toggles.allow_admin_edit_store_identity !== 'true') {
        delete settings.store_name;
        delete settings.store_address;
      }
      if (toggles.allow_admin_hide_store_identity !== 'true') {
        delete settings.show_store_name;
        delete settings.show_store_address;
      }
    }

    if (Object.keys(settings).length > 0) {
      await prisma.$transaction(
        Object.entries(settings).map(([key, val]) =>
          prisma.systemSetting.upsert({
            where: { key },
            update: { value: String(val) },
            create: { key, value: String(val) }
          })
        )
      );
    }

    await logSecurityAudit({
      action: 'SETTINGS_UPDATE',
      module: 'SETTINGS',
      status: 'SUCCESS',
      details: `Settings updated by ${actingUser?.username || 'system'}`,
      userId: actingUser?.id,
      userName: actingUser?.username
    });

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: unknown) {
    sendError(res, error);
  }
});

export default router;
