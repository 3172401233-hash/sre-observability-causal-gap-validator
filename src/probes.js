function verdictFor(hypothesis, coversEntry, status) {
  if (!coversEntry) {
    return 'not_covering_affected_entry';
  }
  if (hypothesis === 'traffic_drop') {
    return status === 'fail' ? 'confirms_outage' : 'conflicting_passing_probe';
  }
  if (hypothesis === 'collection_failure' || hypothesis === 'sampling_change') {
    return status === 'fail' ? 'covered_failing_probe' : 'covered_passing_probe';
  }
  return 'inconclusive';
}

const VERDICT_DETAIL = {
  not_covering_affected_entry: '探针走不同入口，不覆盖受影响租户入口，通过结果不能反证缺口',
  confirms_outage: '同入口探针失败，与真实流量下降一致',
  conflicting_passing_probe: '同入口探针仍然通过，与流量下降结论冲突，需要降低置信度并复核',
  covered_failing_probe: '同入口探针失败，佐证采集/采样侧问题已影响外部可达性',
  covered_passing_probe: '同入口探针通过：探针自造流量，无法证明租户真实业务健康',
  inconclusive: '探针结果与当前假设无直接因果关系',
};

export function routeEntryFor(input, tenantId) {
  const route = (input.routes ?? []).find((item) => item.tenantId === tenantId);
  return route?.entry ?? null;
}

// 为单个归因结论标注合成监控的真实覆盖范围。
export function assessProbes(input, tenantId, hypothesis) {
  const tenantEntry = routeEntryFor(input, tenantId);
  const probes = Array.isArray(input.probes) ? input.probes : [];
  const probeEntries = [...new Set(probes.map((probe) => probe.entry))];

  const assessments = probes.map((probe) => {
    const coversEntry = probe.entry === tenantEntry;
    const verdict = verdictFor(hypothesis, coversEntry, probe.status);
    return {
      probeId: probe.id,
      entry: probe.entry,
      tenantEntry,
      status: probe.status,
      coversAffectedEntry: coversEntry,
      verdict,
      detail: VERDICT_DETAIL[verdict],
    };
  });

  const coveredEntry = assessments.some((item) => item.coversAffectedEntry);
  let coverageNote;
  if (!tenantEntry) {
    coverageNote = '缺少租户路由入口数据，无法评估探针覆盖范围';
  } else if (!coveredEntry) {
    coverageNote = `合成监控只覆盖入口 ${probeEntries.join(', ') || '无'}，未覆盖租户入口 ${tenantEntry}，存在入口覆盖缺口`;
  } else {
    coverageNote = `合成监控覆盖租户入口 ${tenantEntry}，但探针结果只能证明该入口的合成可用性`;
  }

  return {
    tenantId,
    tenantEntry,
    probeEntries,
    coveredEntry,
    coverageNote,
    assessments,
  };
}
