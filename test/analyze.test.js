import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { analyze } from '../src/index.js';
import {
  certExpiryInput,
  cloneInput,
  indeterminateInput,
  realTrafficDropInput,
  samplingChangeInput,
} from './helpers.js';

const execFileAsync = promisify(execFile);

test('证书过期：三信号同时下降但业务仍有流量，归因为采集故障而非流量消失', () => {
  const report = analyze(certExpiryInput());
  assert.equal(report.summary.intervalCount, 1);
  assert.deepEqual(report.affectedTenants, ['tenant-a']);

  const finding = report.missingIntervals[0];
  assert.equal(finding.hypothesis, 'collection_failure');
  assert.equal(finding.isRealOutage, false);
  assert.equal(finding.interval.start, '2026-11-24T02:05:00.000Z');
  assert.equal(finding.interval.end, '2026-11-24T02:09:00.000Z');
  assert.equal(finding.interval.bucketCount, 4);

  const evidenceKinds = finding.evidence.map((item) => item.kind);
  assert.ok(evidenceKinds.includes('certificate'));
  assert.ok(evidenceKinds.includes('collector_status'));
  assert.ok(evidenceKinds.includes('business_events'));
  assert.equal(finding.businessVolume.present, true);

  const probe = finding.probeAssessment.assessments[0];
  assert.equal(probe.coversAffectedEntry, false);
  assert.equal(probe.verdict, 'not_covering_affected_entry');
  assert.equal(finding.probeAssessment.coveredEntry, false);
  assert.match(finding.probeAssessment.coverageNote, /入口覆盖缺口/);
});

test('真实流量下降：业务事件同步归零，同入口探针失败，判定真实故障', () => {
  const report = analyze(realTrafficDropInput());
  const finding = report.missingIntervals[0];
  assert.equal(finding.hypothesis, 'traffic_drop');
  assert.equal(finding.isRealOutage, true);
  assert.equal(finding.confidence, 'high');
  assert.equal(finding.businessVolume.present, false);
  assert.equal(report.summary.realOutageCount, 1);

  const probe = finding.probeAssessment.assessments[0];
  assert.equal(probe.coversAffectedEntry, true);
  assert.equal(probe.verdict, 'confirms_outage');

  assert.ok(
    !finding.evidence.some((item) => item.kind === 'certificate' || item.kind === 'sampling'),
  );
});

test('采样变更：trace 降采样被归一化吸收，不产生缺口并显式报告采样观察', () => {
  const report = analyze(samplingChangeInput());
  assert.equal(report.missingIntervals.length, 0);
  assert.equal(report.affectedTenants.length, 0);
  assert.equal(report.summary.realOutageCount, 0);

  const observation = report.samplingObservations.find(
    (item) => item.signal === 'traces',
  );
  assert.ok(observation);
  assert.equal(observation.changed, true);
  assert.equal(observation.baselineRate, 0.1);
  assert.equal(observation.minRate, 0.01);

  const probe = analyze(samplingChangeInput());
  assert.equal(
    probe.tenantsAnalyzed.includes('tenant-c'),
    true,
  );
});

test('部分信号缺失的降采样被归类为 sampling_change 而非业务故障', () => {
  const input = samplingChangeInput();
  input.telemetry['tenant-c'].traces = input.telemetry['tenant-c'].traces.map((bucket) => ({
    ...bucket,
    count:
      bucket.timestamp >= '2026-11-24T02:05:00.000Z' &&
      bucket.timestamp <= '2026-11-24T02:08:00.000Z'
        ? 0
        : bucket.count,
  }));
  const report = analyze(input);
  assert.equal(report.missingIntervals.length, 0);
  assert.equal(report.partialAnomalies.length, 4);
  assert.ok(
    report.partialAnomalies.every((item) => item.hypothesis === 'sampling_change'),
  );
  assert.ok(
    report.partialAnomalies.every((item) => item.isRealOutage === false),
  );
});

test('入口差异：不同入口探针通过不能反证缺口；同入口探针通过会产生冲突标注', () => {
  const differentEntry = analyze(certExpiryInput());
  const probe = differentEntry.missingIntervals[0].probeAssessment;
  assert.equal(probe.tenantEntry, 'edge-east');
  assert.deepEqual(probe.probeEntries, ['cdn-public']);
  assert.equal(probe.assessments[0].coversAffectedEntry, false);

  const sameEntryInput = cloneInput(certExpiryInput());
  sameEntryInput.probes = [{ id: 'probe-east', entry: 'edge-east', status: 'pass' }];
  const sameEntry = analyze(sameEntryInput);
  const assessment = sameEntry.missingIntervals[0].probeAssessment.assessments[0];
  assert.equal(assessment.coversAffectedEntry, true);
  assert.equal(assessment.verdict, 'covered_passing_probe');
  assert.match(assessment.detail, /自造流量/);

  const trafficInput = realTrafficDropInput();
  trafficInput.probes = [{ id: 'probe-east', entry: 'edge-east', status: 'pass' }];
  const conflicting = analyze(trafficInput).missingIntervals[0];
  assert.equal(
    conflicting.probeAssessment.assessments[0].verdict,
    'conflicting_passing_probe',
  );
  assert.equal(conflicting.confidence, 'medium');
  assert.ok(conflicting.evidence.some((item) => item.kind === 'synthetic_probe'));
});

test('证据不足时返回 indeterminate，任何单一信号都不能独立证明健康', () => {
  const report = analyze(indeterminateInput());
  const finding = report.missingIntervals[0];
  assert.equal(finding.hypothesis, 'indeterminate');
  assert.equal(finding.isRealOutage, false);
  assert.equal(finding.confidence, 'low');
  assert.match(report.singleSignalRule, /单一信号/);
  assert.match(finding.rationale, /数据不足/);
});

test('多租户隔离：证书只影响被分配的租户，其他租户保持正常', () => {
  const input = certExpiryInput();
  input.telemetry['tenant-b'] = {
    metrics: [
      { timestamp: '2026-11-24T02:05:00.000Z', tenantId: 'tenant-b', count: 100 },
      { timestamp: '2026-11-24T02:06:00.000Z', tenantId: 'tenant-b', count: 101 },
    ],
    logs: [
      { timestamp: '2026-11-24T02:05:00.000Z', tenantId: 'tenant-b', count: 50 },
      { timestamp: '2026-11-24T02:06:00.000Z', tenantId: 'tenant-b', count: 49 },
    ],
    traces: [
      { timestamp: '2026-11-24T02:05:00.000Z', tenantId: 'tenant-b', count: 10, sampleRate: 0.1 },
      { timestamp: '2026-11-24T02:06:00.000Z', tenantId: 'tenant-b', count: 10, sampleRate: 0.1 },
    ],
  };
  input.collectors.push({
    id: 'collector-healthy',
    assignedTenants: ['tenant-b'],
    statusHistory: [{ timestamp: '2026-11-24T01:00:00.000Z', status: 'running' }],
    certificate: {
      id: 'cert-healthy',
      notBefore: '2026-11-23T00:00:00.000Z',
      notAfter: '2027-11-23T00:00:00.000Z',
    },
  });
  input.businessEvents['tenant-b'] = [
    { timestamp: '2026-11-24T02:05:00.000Z', tenantId: 'tenant-b', orders: 40 },
    { timestamp: '2026-11-24T02:06:00.000Z', tenantId: 'tenant-b', orders: 41 },
  ];
  input.routes.push({ tenantId: 'tenant-b', entry: 'edge-south' });

  const report = analyze(input);
  assert.deepEqual(report.affectedTenants, ['tenant-a']);
  assert.deepEqual(report.missingIntervals[0].affectedCollectors, ['collector-1']);
});

test('输入校验：缺少信号数组或非法计数直接报错', () => {
  const input = certExpiryInput();
  delete input.telemetry['tenant-a'].logs;
  assert.throws(() => analyze(input), /缺少信号数组 logs/);

  const badCount = certExpiryInput();
  badCount.telemetry['tenant-a'].metrics[0].count = 'n/a';
  assert.throws(() => analyze(badCount), /count 必须是数字/);
});

test('CLI 只消费本地离线 JSON 文件并输出结构化报告', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gap-validator-'));
  try {
    const filePath = join(directory, 'input.json');
    await writeFile(filePath, JSON.stringify(certExpiryInput()));
    const { stdout } = await execFileAsync(process.execPath, [
      join(process.cwd(), 'src', 'cli.js'),
      filePath,
    ]);
    const report = JSON.parse(stdout);
    assert.equal(report.missingIntervals[0].hypothesis, 'collection_failure');

    const pretty = await execFileAsync(process.execPath, [
      join(process.cwd(), 'src', 'cli.js'),
      filePath,
      '--pretty',
    ]);
    assert.match(pretty.stdout, /采集故障/);
    assert.match(pretty.stdout, /入口覆盖缺口/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
