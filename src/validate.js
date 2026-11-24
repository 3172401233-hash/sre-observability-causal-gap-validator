import { toEpochMillis } from './time.js';
import { SIGNAL_TYPES } from './tuning.js';

function assert(condition, message) {
  if (!condition) {
    throw new TypeError(message);
  }
}

export function validateInput(input) {
  assert(input && typeof input === 'object', '输入必须是对象');
  assert(input.telemetry && typeof input.telemetry === 'object', '缺少 telemetry 对象');

  for (const [tenantId, tenantTelemetry] of Object.entries(input.telemetry)) {
    assert(tenantTelemetry && typeof tenantTelemetry === 'object', `租户 ${tenantId} 的 telemetry 必须是对象`);
    for (const signal of SIGNAL_TYPES) {
      const buckets = tenantTelemetry[signal];
      assert(Array.isArray(buckets), `租户 ${tenantId} 缺少信号数组 ${signal}`);
      for (const bucket of buckets) {
        assert(bucket && typeof bucket.timestamp !== 'undefined', `租户 ${tenantId} 的 ${signal} 桶缺少 timestamp`);
        assert(Number.isFinite(Number(bucket.count)), `租户 ${tenantId} 的 ${signal} 桶 count 必须是数字`);
        if (signal === 'traces' && bucket.sampleRate !== undefined) {
          assert(Number.isFinite(bucket.sampleRate) && bucket.sampleRate > 0, `租户 ${tenantId} 的 traces sampleRate 必须为正数`);
        }
        assert(!Number.isNaN(toEpochMillis(bucket.timestamp)), `租户 ${tenantId} 存在无法解析的 timestamp`);
      }
    }
  }

  for (const collector of input.collectors ?? []) {
    assert(collector && collector.id, '每个采集器必须包含 id');
    if (collector.certificate) {
      assert(collector.certificate.notAfter, `采集器 ${collector.id} 的证书缺少 notAfter`);
      assert(!Number.isNaN(toEpochMillis(collector.certificate.notAfter)), `采集器 ${collector.id} 的 notAfter 无法解析`);
    }
    for (const event of collector.statusHistory ?? []) {
      assert(event.timestamp && event.status, `采集器 ${collector.id} 的状态事件必须包含 timestamp 与 status`);
    }
  }

  for (const probe of input.probes ?? []) {
    assert(probe.id && probe.entry && probe.status, '每个探针必须包含 id、entry、status');
  }

  for (const route of input.routes ?? []) {
    assert(route.tenantId && route.entry, '每条路由必须包含 tenantId 与 entry');
  }
}
