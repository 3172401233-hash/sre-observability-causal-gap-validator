// 离线测试夹具：所有数据都是固定时间戳的历史数据，测试不访问网络或实时时钟。

export function buckets(tenantId, signal, values, options = {}) {
  return values.map((value, index) => {
    const bucket = {
      timestamp: `2026-11-24T02:0${index}:00.000Z`,
      tenantId,
      count: value,
    };
    if (signal === 'traces') {
      const rates = options.sampleRates ?? [];
      bucket.sampleRate = rates[index] ?? options.sampleRate ?? 0.1;
    }
    return bucket;
  });
}

export function businessBuckets(tenantId, values, field = 'orders') {
  return values.map((value, index) => ({
    timestamp: `2026-11-24T02:0${index}:00.000Z`,
    tenantId,
    [field]: value,
  }));
}

export function certExpiryInput() {
  const gapZero = (value, index) => (index >= 5 && index <= 8 ? 0 : value);
  const tenant = 'tenant-a';
  return {
    analyzedAt: '2026-11-24T02:10:00.000Z',
    telemetry: {
      [tenant]: {
        metrics: buckets(tenant, 'metrics', [100, 102, 98, 101, 99, 0, 0, 0, 0, 100]),
        logs: buckets(tenant, 'logs', [50, 52, 49, 51, 50, 0, 0, 0, 0, 50]),
        traces: buckets(
          tenant,
          'traces',
          [10, 11, 9, 10, 10, 0, 0, 0, 0, 10],
          { sampleRate: 0.1 },
        ),
      },
    },
    collectors: [
      {
        id: 'collector-1',
        assignedTenants: [tenant],
        statusHistory: [
          { timestamp: '2026-11-24T01:00:00.000Z', status: 'running' },
          { timestamp: '2026-11-24T02:05:00.000Z', status: 'error', detail: 'TLS certificate expired' },
        ],
        certificate: {
          id: 'cert-1',
          notBefore: '2026-08-01T00:00:00.000Z',
          notAfter: '2026-11-23T00:00:00.000Z',
        },
      },
    ],
    routes: [{ tenantId: tenant, entry: 'edge-east' }],
    probes: [
      { id: 'probe-cdn', entry: 'cdn-public', status: 'pass' },
    ],
    businessEvents: {
      [tenant]: businessBuckets(tenant, [40, 41, 39, 40, 42, 41, 40, 43, 42, 40]),
    },
  };
}

export function realTrafficDropInput() {
  const tenant = 'tenant-b';
  return {
    analyzedAt: '2026-11-24T02:10:00.000Z',
    telemetry: {
      [tenant]: {
        metrics: buckets(tenant, 'metrics', [100, 100, 100, 100, 100, 0, 0, 0, 0, 100]),
        logs: buckets(tenant, 'logs', [50, 50, 50, 50, 50, 0, 0, 0, 0, 50]),
        traces: buckets(
          tenant,
          'traces',
          [10, 10, 10, 10, 10, 0, 0, 0, 0, 10],
          { sampleRate: 0.1 },
        ),
      },
    },
    collectors: [
      {
        id: 'collector-2',
        assignedTenants: [tenant],
        statusHistory: [{ timestamp: '2026-11-24T01:00:00.000Z', status: 'running' }],
        certificate: {
          id: 'cert-2',
          notBefore: '2026-11-23T00:00:00.000Z',
          notAfter: '2027-11-23T00:00:00.000Z',
        },
      },
    ],
    routes: [{ tenantId: tenant, entry: 'edge-east' }],
    probes: [{ id: 'probe-gateway', entry: 'edge-east', status: 'fail' }],
    businessEvents: {
      [tenant]: businessBuckets(tenant, [40, 40, 40, 40, 40, 0, 0, 0, 0, 40]),
    },
  };
}

export function samplingChangeInput() {
  const tenant = 'tenant-c';
  const sampleRates = [0.1, 0.1, 0.1, 0.1, 0.1, 0.01, 0.01, 0.01, 0.01, 0.1];
  return {
    analyzedAt: '2026-11-24T02:10:00.000Z',
    telemetry: {
      [tenant]: {
        metrics: buckets(tenant, 'metrics', [100, 100, 100, 100, 100, 101, 99, 100, 100, 100]),
        logs: buckets(tenant, 'logs', [50, 50, 50, 50, 50, 51, 49, 50, 50, 50]),
        traces: buckets(
          tenant,
          'traces',
          [10, 10, 10, 10, 10, 1, 1, 1, 1, 10],
          { sampleRates },
        ),
      },
    },
    collectors: [
      {
        id: 'collector-3',
        assignedTenants: [tenant],
        statusHistory: [{ timestamp: '2026-11-24T01:00:00.000Z', status: 'running' }],
        certificate: {
          id: 'cert-3',
          notBefore: '2026-11-23T00:00:00.000Z',
          notAfter: '2027-11-23T00:00:00.000Z',
        },
      },
    ],
    routes: [{ tenantId: tenant, entry: 'edge-west' }],
    probes: [{ id: 'probe-west', entry: 'edge-west', status: 'pass' }],
    businessEvents: {
      [tenant]: businessBuckets(tenant, [40, 40, 40, 40, 40, 41, 40, 39, 40, 40]),
    },
  };
}

export function indeterminateInput() {
  const tenant = 'tenant-d';
  return {
    analyzedAt: '2026-11-24T02:10:00.000Z',
    telemetry: {
      [tenant]: {
        metrics: buckets(tenant, 'metrics', [100, 100, 100, 100, 100, 0, 0, 0, 0, 100]),
        logs: buckets(tenant, 'logs', [50, 50, 50, 50, 50, 0, 0, 0, 0, 50]),
        traces: buckets(
          tenant,
          'traces',
          [10, 10, 10, 10, 10, 0, 0, 0, 0, 10],
          { sampleRate: 0.1 },
        ),
      },
    },
    collectors: [
      {
        id: 'collector-4',
        assignedTenants: [tenant],
        statusHistory: [{ timestamp: '2026-11-24T01:00:00.000Z', status: 'running' }],
        certificate: {
          id: 'cert-4',
          notBefore: '2026-11-23T00:00:00.000Z',
          notAfter: '2027-11-23T00:00:00.000Z',
        },
      },
    ],
    routes: [{ tenantId: tenant, entry: 'edge-north' }],
    probes: [{ id: 'probe-north', entry: 'edge-north', status: 'pass' }],
    businessEvents: {
      [tenant]: businessBuckets(tenant, [40, 40, 40, 40, 40, 41, 40, 39, 40, 40]),
    },
  };
}

export function cloneInput(input) {
  return JSON.parse(JSON.stringify(input));
}
