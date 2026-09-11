const AuditLog = require('../models/AuditLog');
const SecurityEvent = require('../models/SecurityEvent');

async function logAudit(params) {
  try {
    const { actorId, actorRole, action, entityType, entityId, metadata = {}, req = null } = params;
    let ipHash = '';
    let userAgentSummary = '';

    if (req) {
      ipHash = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0];
      userAgentSummary = (req.headers['user-agent'] || '').substring(0, 100);
    }

    return await AuditLog.create({
      actorId,
      actorRole,
      action,
      entityType,
      entityId,
      metadata,
      ipHash,
      userAgentSummary
    });
  } catch (err) {
    console.error('[AUDIT-SERVICE] Error writing audit log:', err);
    return null;
  }
}

async function logSecurityEvent(params) {
  try {
    const { type, actorId = null, severity = 'INFO', metadata = {} } = params;
    return await SecurityEvent.create({
      type,
      actorId,
      severity,
      metadata
    });
  } catch (err) {
    console.error('[AUDIT-SERVICE] Error writing security event:', err);
    return null;
  }
}

module.exports = {
  logAudit,
  logSecurityEvent
};
