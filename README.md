# sre-observability-causal-gap-validator

离线可观测性因果缺口分析器：当指标、日志、trace 同时下降时，区分缺口来自**真实流量下降**、**采样变更**还是**采集器故障**，并标注合成监控的入口覆盖范围。

典型事故场景：值班人员看到三类遥测同时归零，误判为“流量消失”；实际是采集器证书过期后只停止处理该租户的数据，而合成探针走了另一个入口所以仍然通过。本工具用离线数据复现并证伪这类误判。

## 离线约束

- **只消费离线指标**：输入是一份本地 JSON（历史计数、状态、证书、路由、探针结果、业务事件），不发起任何网络请求，不订阅实时数据，也不依赖系统当前时钟。
- 无第三方依赖，仅使用 Node.js 内置模块；运行环境要求 Node.js `24.16.0`（`engines` 已声明）。
- 时间判定全部基于输入中的 ISO 时间戳（如证书 `notAfter`、状态事件时间、桶时间戳）。

## 安装与测试

```bash
node --test
# 或
npm test
```

测试覆盖：真实流量下降、trace 采样变更、证书过期采集故障、合成探针入口差异、证据不足的 `indeterminate`、多租户隔离、输入校验和 CLI 集成。

## 使用方式

```bash
# 结构化 JSON 报告
node src/cli.js examples/certificate-expiry.json

# 人工可读报告
node src/cli.js examples/certificate-expiry.json --pretty
```

库调用：

```js
import { readFile } from 'node:fs/promises';
import { analyze } from './src/index.js';

const input = JSON.parse(await readFile('examples/certificate-expiry.json', 'utf8'));
const report = analyze(input);
```

## 输入契约

| 字段 | 说明 |
| --- | --- |
| `telemetry.<tenant>.metrics/logs/traces` | 每桶 `timestamp` 与原始 `count`；`traces` 桶可带 `sampleRate`（0,1]） |
| `collectors[].statusHistory` | 采集器状态事件（`running`/`error`/`stopped`），按时间戳取最近一条 |
| `collectors[].certificate` | 证书 `notBefore`/`notAfter`，用于离线判断是否过期 |
| `collectors[].assignedTenants` | 采集器负责的租户；未配置时视为负责全部租户 |
| `routes[]` | 租户到路由入口（`entry`）的映射 |
| `probes[]` | 合成探针的 `entry` 与结果（`pass`/`fail`） |
| `businessEvents.<tenant>` | 业务事件桶（显式 `value` 或其余数值字段求和），是判断真实流量的关键 |

## 判定规则

1. **归一化与基线**：每个信号按 `count / sampleRate` 归一化（metrics、logs 采样率视为 1），用历史桶中位数作为基线；归一化值低于基线 10% 记为该桶缺失。
2. **缺失区间**：只有 metrics、logs、traces **三类信号同时缺失**才形成候选缺口区间；仅部分信号缺失记为 `partialAnomalies`，用于识别 trace 降采样。
3. **因果优先级**：
   - 证书过期或采集器 `error/stopped` 与区间重合，且业务事件仍有量 → `collection_failure`（非真实故障）。
   - 采样率显著下降且只影响被采样信号 → `sampling_change`（非真实故障）；若 metrics/logs 同时缺失，会附加矛盾证据并降低置信度，因为它们不经过 trace 采样。
   - 采集与采样均正常，业务事件同步归零 → `traffic_drop`（真实故障，`isRealOutage: true`）。
   - 证据不足 → `indeterminate`，禁止强行归因。
4. **单一信号规则**：任何单一信号都不能独立证明业务健康，结论必须结合业务事件、采集器状态、采样率与探针覆盖。

## 合成探针覆盖标注

探针按 `routes` 中的租户入口标注覆盖范围：

- 探针入口与租户入口不同：`not_covering_affected_entry`，即使通过也**不能反证**缺口（题述事故的核心）。
- 同入口通过（采集/采样类假设）：`covered_passing_probe`，探针只证明自造流量的合成可用性，不证明租户真实业务健康。
- 同入口失败（真实流量下降）：`confirms_outage`；同入口通过则为 `conflicting_passing_probe`，自动把置信度从 high 降到 medium 并附加冲突证据。
- 没有任何探针覆盖租户入口时，报告 `coverageNote` 入口覆盖缺口。

## 输出结构

- `missingIntervals`：每个缺口的起止时间（结束时间为半开区间）、假设、置信度、`isRealOutage`、因果证据链、业务量、受影响采集器与探针覆盖评估。
- `partialAnomalies`：部分信号缺失（典型为降采样）的单点结论。
- `samplingObservations`：全窗口采样率变更观察，即使归一化后没有缺口也会显式报告。
- `affectedTenants`：存在缺口区间的租户列表；`summary` 给出按假设分类的计数与真实故障数。

## 目录结构

```text
src/
  analyze.js     # 编排入口
  intervals.js   # 归一化、基线、缺失区间检测
  classify.js    # 因果归因与证据链
  probes.js      # 合成探针入口覆盖标注
  collector.js   # 采集器状态与证书过期判断
  sampling.js    # 采样率归一化与采样变更
  business.js    # 业务事件基线
  validate.js    # 离线输入校验
  cli.js         # 本地 JSON 离线 CLI
test/            # node --test 测试与离线夹具
examples/        # 离线示例输入
```
