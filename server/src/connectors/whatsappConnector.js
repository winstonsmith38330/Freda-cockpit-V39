import { parseWhatsappUpload } from '../whatsappParser.js';

export function syncWhatsappUpload(file) {
  const parsed = parseWhatsappUpload(file);
  if (!parsed.ok) {
    const message = parsed.error || 'WhatsApp upload could not be parsed.';
    return {
      ok: false,
      status: 'failed',
      error: message,
      errors: [message],
      parsed,
      diagnostics: parsed.diagnostics || {},
      note: 'Upload the WhatsApp export .txt file or a .zip containing a readable chat .txt export. Exports without media are preferred.'
    };
  }
  return {
    ok: true,
    status: 'success',
    source: 'WhatsApp export parser',
    capturedAt: new Date().toISOString(),
    summary: parsed,
    actions: parsed.actions || [],
    warnings: parsed.warnings || [],
    diagnostics: parsed.diagnostics || {},
    notes: 'Phase 1 parser supports exported .txt/.zip stock, sold-out and leftover messages. Photo vision/OCR is staged.'
  };
}

export function whatsappDiagnostics() {
  return {
    source: 'WhatsApp export parser',
    status: 'available',
    normalWorkflow: 'Upload WhatsApp export .txt or .zip. V34 returns parse diagnostics instead of a generic upload failure.',
    parsedSignals: ['sell-out time', 'leftover notes', 'stock usage words', 'store names', 'urgent manager actions'],
    supportedFiles: ['.txt', '.zip containing .txt or WhatsApp chat text'],
    recommendation: 'Export without media when possible. Media-heavy ZIPs can still be uploaded, but only text chat content is parsed in Phase 1.'
  };
}
