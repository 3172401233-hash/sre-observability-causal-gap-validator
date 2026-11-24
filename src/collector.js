import { toEpochMillis } from './time.js';

// 证书是否在指定时刻过期（离线判断，只依赖输入的 notAfter/notBefore）。
export function certStateAt(certificate, atMillis) {
  if (!certificate) {
    return null;
  }
  const notAfter = toEpochMillis(certificate.notAfter);
  const notBefore = certificate.notBefore
    ? toEpochMillis(certificate.notBefore)
    : null;
  return {
    id: certificate.id,
    notBefore: certificate.notBefore ?? null,
    notAfter: certificate.notAfter,
    expired: atMillis >= notAfter || (notBefore !== null && atMillis < notBefore),
  };
}

function latestEventAt(history, atMillis) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }
  const past = history
    .filter((event) => toEpochMillis(event.timestamp) <= atMillis)
    .sort(
      (left, right) => toEpochMillis(right.timestamp) - toEpochMillis(left.timestamp),
    );
  return past[0] ?? null;
}

const FAULT_STATUSES = new Set(['error', 'stopped']);

export function collectorStateAt(history, atMillis) {
  const event = latestEventAt(history, atMillis);
  if (!event) {
    return { status: 'unknown', event: null };
  }
  return { status: event.status, event };
}

export function collectorFaultAt(history, atMillis) {
  const state = collectorStateAt(history, atMillis);
  return FAULT_STATUSES.has(state.status);
}

// 解析负责某租户的采集器：显式 assignedTenants 优先，未配置时回退到全部采集器。
export function collectorsForTenant(input, tenantId) {
  const collectors = Array.isArray(input.collectors) ? input.collectors : [];
  const assigned = collectors.filter((collector) =>
    Array.isArray(collector.assignedTenants)
      ? collector.assignedTenants.includes(tenantId)
      : true,
  );
  return assigned.length > 0 ? assigned : collectors;
}
