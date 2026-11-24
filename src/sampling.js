import { median, round } from './stats.js';
import { TUNING } from './tuning.js';

// metrics/logs 不做采样，视为采样率恒为 1；traces 使用桶上记录的采样率。
export function samplingRateFor(signal, bucket) {
  if (signal !== 'traces') {
    return 1;
  }
  const rate = bucket?.sampleRate;
  if (!Number.isFinite(rate) || rate <= 0) {
    return 1;
  }
  return rate;
}

export function normalizeCount(signal, bucket) {
  const rate = samplingRateFor(signal, bucket);
  const raw = Number(bucket?.count) || 0;
  return raw / rate;
}

export function medianSamplingRate(signal, buckets) {
  return median(buckets.map((bucket) => samplingRateFor(signal, bucket)));
}

// 比较区间内采样率相对基线的变化，返回每个信号的变化描述。
export function describeSamplingChange(signal, baselineBuckets, gapBuckets) {
  const baselineRate = medianSamplingRate(signal, baselineBuckets);
  const gapRate = medianSamplingRate(signal, gapBuckets);
  const changed =
    baselineRate > 0 &&
    gapRate < baselineRate * (1 - TUNING.SAMPLING_CHANGE_RATIO);
  return {
    signal,
    baselineRate: round(baselineRate),
    gapRate: round(gapRate),
    changed,
  };
}

// 全窗口采样观察：即使归一化后没有缺口，也要显式报告采样率发生过变更。
export function summarizeSampling(signal, buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return { signal, baselineRate: 1, minRate: 1, changed: false };
  }
  const rates = buckets.map((bucket) => samplingRateFor(signal, bucket));
  const baselineRate = median(rates);
  const minRate = Math.min(...rates);
  return {
    signal,
    baselineRate: round(baselineRate),
    minRate: round(minRate),
    changed: minRate < baselineRate * (1 - TUNING.SAMPLING_CHANGE_RATIO),
  };
}
