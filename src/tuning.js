// 判定阈值集中管理，便于审计与调参。
export const TUNING = {
  // 归一化计数低于基线的该比例即视为该信号在该桶缺失。
  MISSING_RATIO: 0.1,
  // 业务量低于基线的该比例即视为业务流量消失。
  BUSINESS_ABSENT_RATIO: 0.1,
  // 采样率相对基线下降超过该比例才算采样变更。
  SAMPLING_CHANGE_RATIO: 0.05,
};

export const SIGNAL_TYPES = ['metrics', 'logs', 'traces'];
