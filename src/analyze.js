import { classifyInterval, classifyPartialAnomaly } from './classify.js';
import { detectTenantIntervals } from './intervals.js';
import { assessProbes } from './probes.js';
import { summarizeSampling } from './sampling.js';
import { validateInput } from './validate.js';
import { SIGNAL_TYPES } from './tuning.js';

// 离线分析入口：只消费输入中已有的指标/日志/trace/状态/证书/路由/探针/业务事件。
export function analyze(input) {
  validateInput(input);

  const tenants = Object.keys(input.telemetry);
  const findings = [];
  const partialFindings = [];
  const affectedTenants = new Set();
  const samplingObservations = [];

  for (const tenantId of tenants) {
    const tenantTelemetry = input.telemetry[tenantId];
    const tenantBusiness = input.businessEvents?.[tenantId] ?? [];
    const detection = detectTenantIntervals(tenantId, tenantTelemetry);

    for (const interval of detection.intervals) {
      const finding = classifyInterval(
        input,
        tenantId,
        interval,
        tenantTelemetry,
        tenantBusiness,
      );
      finding.baselines = detection.baselines;
      finding.probeAssessment = assessProbes(input, tenantId, finding.hypothesis);
      const conflictingProbe = finding.probeAssessment.assessments.find(
        (item) => item.verdict === 'conflicting_passing_probe',
      );
      if (conflictingProbe && finding.confidence === 'high') {
        finding.confidence = 'medium';
        finding.evidence.push({
          kind: 'synthetic_probe',
          supports: 'none',
          detail: `同入口探针 ${conflictingProbe.probeId} 仍然通过，与流量下降结论冲突，置信度降为 medium`,
        });
      }
      findings.push(finding);
      affectedTenants.add(tenantId);
    }

    for (const anomaly of detection.partialAnomalies) {
      partialFindings.push(classifyPartialAnomaly(tenantId, anomaly, tenantTelemetry));
    }

    for (const signal of SIGNAL_TYPES) {
      const summary = summarizeSampling(signal, tenantTelemetry[signal] ?? []);
      if (summary.changed) {
        samplingObservations.push({ tenantId, ...summary });
      }
    }
  }

  const countsByHypothesis = findings.reduce((acc, finding) => {
    acc[finding.hypothesis] = (acc[finding.hypothesis] ?? 0) + 1;
    return acc;
  }, {});

  return {
    schemaVersion: 1,
    analyzedAt: input.analyzedAt ?? null,
    signals: [...SIGNAL_TYPES],
    singleSignalRule: '任何单一信号都不能独立证明业务健康；结论必须结合业务事件、采集器状态、采样与探针覆盖范围',
    tenantsAnalyzed: tenants,
    missingIntervals: findings,
    partialAnomalies: partialFindings,
    samplingObservations,
    affectedTenants: [...affectedTenants],
    summary: {
      tenantCount: tenants.length,
      affectedTenantCount: affectedTenants.size,
      intervalCount: findings.length,
      samplingChangeCount: samplingObservations.length,
      countsByHypothesis,
      realOutageCount: findings.filter((finding) => finding.isRealOutage).length,
    },
  };
}
