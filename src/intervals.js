import { inferBucketWidthMillis, midpointMillis, toEpochMillis, toIso } from './time.js';
import { median, round, sum } from './stats.js';
import { normalizeCount } from './sampling.js';
import { TUNING, SIGNAL_TYPES } from './tuning.js';

function buildSignalSeries(tenantTelemetry, signal) {
  const buckets = (tenantTelemetry[signal] ?? []).map((bucket) => ({
    ...bucket,
    signal,
    atMillis: toEpochMillis(bucket.timestamp),
    normalized: normalizeCount(signal, bucket),
  }));
  const baseline = median(buckets.map((bucket) => bucket.normalized).filter((value) => value > 0));
  const threshold = baseline * TUNING.MISSING_RATIO;
  for (const bucket of buckets) {
    bucket.missing = baseline > 0 && bucket.normalized <= threshold;
  }
  return {
    signal,
    baseline: round(baseline),
    missingThreshold: round(threshold),
    buckets: buckets.sort((left, right) => left.atMillis - right.atMillis),
  };
}

function mergeFullGapRuns(gapRows, bucketWidthMillis) {
  const intervals = [];
  let current = [];
  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const startMillis = current[0].atMillis;
    const lastMillis = current[current.length - 1].atMillis;
    const endMillis = bucketWidthMillis
      ? lastMillis + bucketWidthMillis
      : lastMillis;
    const perSignal = Object.fromEntries(
      SIGNAL_TYPES.map((signal) => [
        signal,
        {
          missing: current.every((row) => row.signals[signal]?.missing === true),
          normalizedTotal: round(sum(current.map((row) => row.signals[signal]?.normalized ?? 0))),
          rawTotal: sum(current.map((row) => row.signals[signal]?.bucket?.count ?? 0)),
        },
      ]),
    );
    intervals.push({
      start: toIso(startMillis),
      end: toIso(endMillis),
      startMillis,
      endMillis,
      midpointMillis: midpointMillis(startMillis, endMillis),
      bucketCount: current.length,
      signals: perSignal,
    });
    current = [];
  };

  for (const row of gapRows) {
    const previous = current[current.length - 1];
    if (previous && bucketWidthMillis && row.atMillis - previous.atMillis !== bucketWidthMillis) {
      flush();
    }
    current.push(row);
  }
  flush();
  return intervals;
}

// 检测单租户的遥测缺口。只有三类信号同时缺失才形成候选缺口区间；
// 仅部分信号缺失则记为 partialAnomalies（典型于 trace 采样率变更）。
export function detectTenantIntervals(tenantId, tenantTelemetry) {
  const seriesBySignal = Object.fromEntries(
    SIGNAL_TYPES.map((signal) => [signal, buildSignalSeries(tenantTelemetry, signal)]),
  );
  const bucketIndex = new Map();
  for (const series of Object.values(seriesBySignal)) {
    for (const bucket of series.buckets) {
      if (!bucketIndex.has(bucket.atMillis)) {
        bucketIndex.set(bucket.atMillis, {
          atMillis: bucket.atMillis,
          timestamp: bucket.timestamp,
          signals: {},
        });
      }
      bucketIndex.get(bucket.atMillis).signals[series.signal] = bucket;
    }
  }

  const rows = [...bucketIndex.values()].sort((left, right) => left.atMillis - right.atMillis);
  const fullGapRows = [];
  const partialAnomalies = [];
  for (const row of rows) {
    const missingSignals = SIGNAL_TYPES.filter(
      (signal) => row.signals[signal]?.missing === true,
    );
    const observedSignals = SIGNAL_TYPES.filter((signal) => row.signals[signal]);
    if (missingSignals.length === SIGNAL_TYPES.length) {
      fullGapRows.push(row);
    } else if (missingSignals.length > 0) {
      partialAnomalies.push({
        timestamp: row.timestamp,
        missingSignals,
        observedSignals,
      });
    }
  }

  const bucketWidthMillis = inferBucketWidthMillis(rows.map((row) => row.atMillis));
  const intervals = mergeFullGapRuns(fullGapRows, bucketWidthMillis);
  return {
    tenantId,
    bucketWidthMillis,
    baselines: Object.fromEntries(
      Object.entries(seriesBySignal).map(([signal, series]) => [signal, series.baseline]),
    ),
    intervals: intervals.map((interval) => ({ ...interval, tenantId })),
    partialAnomalies,
  };
}
