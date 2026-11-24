import { median, round } from './stats.js';
import { toEpochMillis } from './time.js';
import { TUNING } from './tuning.js';

const META_FIELDS = new Set(['timestamp', 'tenantId', 'value']);

// 业务事件桶优先使用显式 value；否则把其余数值字段求和，方便离线 fixture 复用。
export function businessValue(bucket) {
  if (Number.isFinite(bucket.value)) {
    return bucket.value;
  }
  return Object.entries(bucket)
    .filter(([key, value]) => !META_FIELDS.has(key) && Number.isFinite(value))
    .reduce((total, [, value]) => total + value, 0);
}
export function buildBusinessProfile(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return null;
  }
  const sorted = [...buckets].sort(
    (left, right) => toEpochMillis(left.timestamp) - toEpochMillis(right.timestamp),
  );
  const values = sorted.map(businessValue);
  const baseline = median(values.filter((value) => value > 0));
  return {
    buckets: sorted,
    baseline,
    present: (value) => baseline > 0 && value > baseline * TUNING.BUSINESS_ABSENT_RATIO,
  };
}

export function businessVolumeAt(profile, atMillis) {
  if (!profile) {
    return null;
  }
  const bucket = profile.buckets.find(
    (item) => toEpochMillis(item.timestamp) === atMillis,
  );
  if (!bucket) {
    return null;
  }
  const value = businessValue(bucket);
  return {
    timestamp: bucket.timestamp,
    value,
    baseline: round(profile.baseline),
    present: profile.present(value),
  };
}
