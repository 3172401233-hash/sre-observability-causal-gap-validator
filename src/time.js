// 纯离线时间工具：只处理输入中已有的时间戳，不访问系统时钟或网络。

export function toEpochMillis(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string') {
    throw new TypeError(`无法解析时间戳: ${String(value)}`);
  }
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) {
    throw new TypeError(`无法解析时间戳: ${value}`);
  }
  return millis;
}

export function toIso(value) {
  return new Date(toEpochMillis(value)).toISOString();
}

// 根据相邻桶推断桶宽（毫秒）；数据不足时返回 null。
export function inferBucketWidthMillis(timestamps) {
  if (timestamps.length < 2) {
    return null;
  }
  const millis = timestamps.map(toEpochMillis).sort((a, b) => a - b);
  const deltas = [];
  for (let index = 1; index < millis.length; index += 1) {
    const delta = millis[index] - millis[index - 1];
    if (delta > 0) {
      deltas.push(delta);
    }
  }
  if (deltas.length === 0) {
    return null;
  }
  return deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
}

export function midpointMillis(startMillis, endMillis) {
  return startMillis + (endMillis - startMillis) / 2;
}
