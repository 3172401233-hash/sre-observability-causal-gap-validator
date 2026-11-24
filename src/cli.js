#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyze } from './analyze.js';

const HYPOTHESIS_LABEL = {
  collection_failure: '采集故障',
  sampling_change: '采样变更',
  traffic_drop: '真实流量下降',
  indeterminate: '无法确定',
};

function printPretty(report) {
  console.log(`分析租户 ${report.summary.tenantCount} 个，缺口区间 ${report.summary.intervalCount} 个，受影响租户 ${report.summary.affectedTenantCount} 个`);
  console.log(`规则：${report.singleSignalRule}`);
  for (const finding of report.missingIntervals) {
    console.log('');
    console.log(`- 租户 ${finding.tenantId} | ${finding.interval.start} ~ ${finding.interval.end} | ${HYPOTHESIS_LABEL[finding.hypothesis]}（置信度 ${finding.confidence}）`);
    console.log(`  结论：${finding.rationale}`);
    for (const item of finding.evidence) {
      console.log(`  证据[${item.supports}] ${item.detail}`);
    }
    console.log(`  探针：${finding.probeAssessment.coverageNote}`);
    for (const probe of finding.probeAssessment.assessments) {
      console.log(`    - ${probe.probeId} 入口=${probe.entry} 状态=${probe.status} 判定=${probe.verdict}`);
    }
  }
  for (const finding of report.partialAnomalies) {
    console.log('');
    console.log(`- 租户 ${finding.tenantId} | ${finding.timestamp} | 部分信号异常 | ${HYPOTHESIS_LABEL[finding.hypothesis]}`);
    console.log(`  缺失信号：${finding.missingSignals.join(', ')}；${finding.rationale}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const pretty = args.includes('--pretty');
  const filePath = args.find((arg) => !arg.startsWith('--'));
  if (!filePath) {
    console.error('用法：node src/cli.js <离线输入.json> [--pretty]');
    process.exitCode = 2;
    return;
  }

  const raw = await readFile(resolve(filePath), 'utf8');
  const input = JSON.parse(raw);
  const report = analyze(input);

  if (pretty) {
    printPretty(report);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
