import { buildBusinessProfile, businessValue } from './business.js';
import { certStateAt, collectorFaultAt, collectorStateAt, collectorsForTenant } from './collector.js';
import { makeEvidence } from './evidence.js';
import { describeSamplingChange } from './sampling.js';
import { round } from './stats.js';
import { toEpochMillis } from './time.js';
import { SIGNAL_TYPES } from './tuning.js';

function collectPipelineEvidence(input, tenantId, interval) {
  const evidence = [];
  const collectors = collectorsForTenant(input, tenantId);
  let hasFault = false;
  let hasExpiredCert = false;

  for (const collector of collectors) {
    const atStart = certStateAt(collector.certificate, interval.startMillis);
    const atMidpoint = certStateAt(collector.certificate, interval.midpointMillis);
    if (atStart && atStart.expired) {
      hasExpiredCert = true;
      evidence.push(
        makeEvidence(
          'certificate',
          'collection_failure',
          `采集器 ${collector.id} 证书 ${atStart.id} 已在区间开始前过期（notAfter=${atStart.notAfter}），仅停止处理该租户数据`,
        ),
      );
    } else if (atMidpoint && atMidpoint.expired) {
      hasExpiredCert = true;
      evidence.push(
        makeEvidence(
          'certificate',
          'collection_failure',
          `采集器 ${collector.id} 证书 ${atMidpoint.id} 在缺口区间内过期（notAfter=${atMidpoint.notAfter}）`,
        ),
      );
    }

    const faultAtStart = collectorFaultAt(collector.statusHistory, interval.startMillis);
    const faultAtMidpoint = collectorFaultAt(collector.statusHistory, interval.midpointMillis);
    const stateAtStart = collectorStateAt(collector.statusHistory, interval.startMillis);
    if (faultAtStart || faultAtMidpoint) {
      hasFault = true;
      evidence.push(
        makeEvidence(
          'collector_status',
          'collection_failure',
          `采集器 ${collector.id} 处于 ${stateAtStart.status} 状态（事件时间=${stateAtStart.event?.timestamp ?? '未知'}）`,
        ),
      );
    }
  }

  return { evidence, hasFault, hasExpiredCert, collectors };
}

function collectSamplingEvidence(tenantTelemetry, interval) {
  const evidence = [];
  const changes = [];
  for (const signal of SIGNAL_TYPES) {
    const buckets = tenantTelemetry[signal] ?? [];
    const baselineBuckets = buckets.filter(
      (bucket) => toEpochMillis(bucket.timestamp) < interval.startMillis,
    );
    const gapBuckets = buckets.filter(
      (bucket) =>
        toEpochMillis(bucket.timestamp) >= interval.startMillis &&
        toEpochMillis(bucket.timestamp) < interval.endMillis,
    );
    if (baselineBuckets.length === 0 || gapBuckets.length === 0) {
      continue;
    }
    const change = describeSamplingChange(signal, baselineBuckets, gapBuckets);
    changes.push(change);
    if (change.changed) {
      evidence.push(
        makeEvidence(
          'sampling',
          'sampling_change',
          `${signal} 采样率由 ${change.baselineRate} 降至 ${change.gapRate}`,
        ),
      );
    }
  }
  return { evidence, changes };
}

function businessInInterval(profile, interval) {
  if (!profile) {
    return null;
  }
  const buckets = profile.buckets.filter(
    (bucket) => {
      const atMillis = toEpochMillis(bucket.timestamp);
      return atMillis >= interval.startMillis && atMillis < interval.endMillis;
    },
  );
  if (buckets.length === 0) {
    return null;
  }
  const average = buckets.reduce((total, bucket) => total + businessValue(bucket), 0) / buckets.length;
  return {
    average: round(average),
    baseline: round(profile.baseline),
    present: profile.present(average),
    timestamps: buckets.map((bucket) => bucket.timestamp),
  };
}

function collectBusinessEvidence(tenantBusiness, interval) {
  const profile = buildBusinessProfile(tenantBusiness);
  const inside = businessInInterval(profile, interval);
  if (!inside) {
    return {
      profile,
      evidence: [
        makeEvidence('business_events', 'none', '区间内缺少业务事件数据，无法独立证明业务健康'),
      ],
      inside: null,
    };
  }
  const supports = inside.present ? 'collection_failure' : 'traffic_drop';
  const wording = inside.present ? '仍有业务流量' : '业务流量同步消失';
  return {
    profile,
    inside,
    evidence: [
      makeEvidence(
        'business_events',
        supports,
        `业务事件均值 ${inside.average}（基线 ${inside.baseline}）：${wording}`,
      ),
    ],
  };
}

function decide(interval, pipeline, sampling, business) {
  const pipelineEvidence = pipeline.hasFault || pipeline.hasExpiredCert;
  const samplingEvidence = sampling.changes.some((change) => change.changed);
  const businessPresent = business.inside?.present === true;
  const businessAbsent = business.inside ? !business.inside.present : false;

  if (pipelineEvidence) {
    return {
      hypothesis: 'collection_failure',
      isRealOutage: false,
      confidence: businessPresent || !business.inside ? 'high' : 'medium',
      rationale: businessPresent
        ? '采集管道故障但业务仍有流量，遥测下降来自采集侧而非真实流量'
        : '采集管道故障与缺口区间重合；业务事件不足或同步异常，需结合业务侧复核',
    };
  }

  if (samplingEvidence) {
    const metricsAndLogsMissing =
      interval.signals.metrics.missing && interval.signals.logs.missing;
    return {
      hypothesis: 'sampling_change',
      isRealOutage: false,
      confidence: metricsAndLogsMissing ? 'medium' : 'high',
      rationale: metricsAndLogsMissing
        ? '采样率发生变更，但 metrics/logs 不受 trace 采样影响却同时缺失，不能用采样单独解释'
        : '缺口与采样率下降一致，且仅影响被采样信号，属于采样变更',
    };
  }

  if (businessAbsent) {
    return {
      hypothesis: 'traffic_drop',
      isRealOutage: true,
      confidence: 'high',
      rationale: '遥测与业务事件同时下降，且采集器/证书/采样均正常，判定为真实流量下降',
    };
  }

  if (businessPresent) {
    return {
      hypothesis: 'indeterminate',
      isRealOutage: false,
      confidence: 'low',
      rationale: '业务仍有流量但缺少采集器故障与采样变更证据，数据不足，无法归因',
    };
  }

  return {
    hypothesis: 'indeterminate',
    isRealOutage: false,
    confidence: 'low',
    rationale: '缺少业务事件与采集管道证据，任何单一遥测信号都不能独立证明业务健康',
  };
}

export function classifyInterval(input, tenantId, interval, tenantTelemetry, tenantBusiness) {
  const pipeline = collectPipelineEvidence(input, tenantId, interval);
  const sampling = collectSamplingEvidence(tenantTelemetry, interval);
  const business = collectBusinessEvidence(tenantBusiness, interval);

  const evidence = [
    ...pipeline.evidence,
    ...sampling.evidence,
    ...business.evidence,
  ];

  const decision = decide(interval, pipeline, sampling, business);
  if (
    decision.hypothesis === 'sampling_change' &&
    interval.signals.metrics.missing &&
    interval.signals.logs.missing
  ) {
    evidence.push(
      makeEvidence(
        'contradiction',
        'collection_failure',
        'metrics 与 logs 不经过 trace 采样却同时缺失，采样变更不能解释全部缺口',
      ),
    );
  }

  return {
    tenantId,
    interval: {
      start: interval.start,
      end: interval.end,
      bucketCount: interval.bucketCount,
      signals: interval.signals,
    },
    hypothesis: decision.hypothesis,
    isRealOutage: decision.isRealOutage,
    confidence: decision.confidence,
    rationale: decision.rationale,
    samplingChanges: sampling.changes,
    businessVolume: business.inside,
    affectedCollectors: pipeline.collectors.map((collector) => collector.id),
    evidence,
  };
}

// 部分信号异常（通常是 trace 降采样）不构成完整缺口，单独给出结论。
export function classifyPartialAnomaly(tenantId, anomaly, tenantTelemetry) {
  const atMillis = toEpochMillis(anomaly.timestamp);
  const interval = {
    startMillis: atMillis,
    endMillis: atMillis + 1,
    midpointMillis: atMillis,
  };
  const sampling = collectSamplingEvidence(tenantTelemetry, interval);
  const changed = sampling.changes.some((change) => change.changed);
  return {
    tenantId,
    timestamp: anomaly.timestamp,
    missingSignals: anomaly.missingSignals,
    hypothesis: changed ? 'sampling_change' : 'indeterminate',
    isRealOutage: false,
    confidence: changed ? 'high' : 'low',
    rationale: changed
      ? '仅被采样信号缺失，采样率变更可以解释，不代表业务受损'
      : '部分信号缺失但未发现采样变更，需要进一步排查',
    samplingChanges: sampling.changes,
    evidence: sampling.evidence,
  };
}
