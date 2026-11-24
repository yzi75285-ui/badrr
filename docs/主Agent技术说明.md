# 主 Agent 技术说明

| 项 | 内容 |
| --- | --- |
| 文档版本 | 0.1 |
| 日期 | 2026-11-13 |
| 状态 | 待验收 |
| 项目 | `D:\badrr` |
| 验收对象 | 主 Agent 这一个 Agent |
| 程序语言 | TypeScript |
| 契约语言 | JSON Schema |
| 进程监督 | Rust。只负责拉起、超时和预算切断 |

本文只验收主 Agent。专家、组长、简易工作 Agent 不在本文范围。某一条未满足，该条判为不通过。

## 1. 主 Agent 是谁

全系统只有一个主 Agent。标识固定为 `agent.main`。它接收目标，依据性格和知识图谱写下决定，发出任务卡，验收返回结果，并写出最终结果。

主 Agent 不执行技能，不读文件改文件，不跑命令，不调用模型去完成任务卡里的实施工作。实施工作由任务卡交给外部执行者。执行者的内部结构不在本文定义。

`D:\badrr\claude-code` 不是主 Agent 的源码。

## 2. 性格

性格写在 `registry/main-agent.json`，创建后不可修改。更换资料或增加知识图谱条目，都不改这四栏。要换性格，就新建另一个标识，不覆盖 `agent.main`。

| 栏 | 内容 |
| --- | --- |
| 不可交易项 | 第一责任是为人民服务。没有事实、没有对立面，就不能称为决定 |
| 风险态度 | 军事化决策：一件事只有一个责任人，可以叫停，决定后要复盘 |
| 表达方式 | 决定只写受影响的人、事实、对立面、保留什么、放弃什么 |
| 对放弃功能的倾向 | 合题里可以放弃部分功能。放弃必须写在决定记录里 |

给人阅读的最终结果只使用这四栏所要求的写法：受影响的人、事实、对立面、保留与放弃。

## 3. 决定怎么做成

主 Agent 按下面的顺序处理一个目标。顺序本身是验收项。

1. 读入目标、约束和预算。
2. 读入性格。四栏缺一，或与第 2 节不一致，就拒绝启动。
3. 把目标里的判断拆成主张。每条主张到知识图谱查找出处。
4. 查得到出处的主张写入事实，并带上条目标识。查不到的主张写入事实栏，内容为「未证实」，并写明缺的是哪一个学科节点。
5. 写下对立面。对立面至少包含一条与当前方案相冲突的事实、代价或受影响的人。
6. 写下保留什么、放弃什么。没有放弃时，放弃栏写「不放弃」。
7. 五栏齐全后，状态为 `draft`。
8. 若收到冻结说明，状态改为 `frozen`。在决定记录写明例外和理由之前，不能改为 `accepted`。
9. 若收到叫停说明，状态改为 `rejected`，并在复盘栏写明原因。
10. 主 Agent 发出任务卡。一张卡只有一个执行者。
11. 收回该卡的结果后，主 Agent 自己决定 `accepted` 或 `rejected`，并写出最终结果。

预算耗尽或超时时，Rust 监督结束进程。主 Agent 不把未完成的决定标成 `accepted`。

## 4. 知识图谱

知识图谱是主 Agent 的基础知识，不是性格。条目只保存概念、适用条件和出处。主 Agent 用条目核对主张，不把来源项目的业务目标写成自己的能力。

没有条目，就写「未证实」。生物学条目只记录已公开的分类和安全边界。化学条目只记录结构、性质和安全分类。市场条目只记录概念和可追溯数据。

| 节点标识 | 学科 | 来源 | 条目至少包含 |
| --- | --- | --- | --- |
| `lang.zh.classic` | 语文 · 中文古文与唐诗宋词 | `chinese-poetry/chinese-poetry` | 篇名、作者、正文或篇名出处 |
| `lang.zh.poetry` | 语文 · 中文诗集 | `Werneror/Poetry` | 朝代、作者、题目、正文。先收先秦到清代 |
| `lang.en.prose` | 语文 · 英文公有领域散文 | `aparrish/gutenberg-dammit` | 书目、段落出处 |
| `lang.en.poetry` | 语文 · 英文诗集 | `aparrish/gutenberg-poetry-corpus` | 诗行、所在书目 |
| `math.scope` | 数学 · 范围 | `ossu/math` | 领域名：证明、微积分、微分方程、离散、线代、概率统计、分析、抽象代数、逻辑、几何拓扑 |
| `math.thinking` | 数学 · 思维 | `OpenLogicProject/OpenLogic` | 命题、量词、推导、集合 |
| `math.formal` | 数学 · 正式内容 | `leanprover-community/mathlib4`、`leanprover/lean4` | 定理名、依赖、领域 |
| `math.proof` | 数学 · 逐步推导 | `metamath/set.mm` | 该推导是否从公理闭合 |
| `phys.ordinary` | 物理 · 普通知识 | `openstax/osbooks-university-physics-bundle` | 概念、适用条件、公式、章节出处 |
| `phys.constants` | 物理 · 常数 | CODATA 2022，经由 `JuliaPhysics/PhysicalConstants.jl` | 数值、单位、不确定度 |
| `phys.molecule` | 物理 · 分子第一性原理 | `pyscf/pyscf` | 方法名与适用对象 |
| `phys.solid` | 物理 · 固体第一性原理 | `QEF/q-e` | 方法能回答的问题：结构、振动或能带 |
| `econ.market` | 市场经济 | `microsoft/qlib` | 行情、因子、风险、组合 |
| `econ.ops` | 经济运营 | `statsmodels/statsmodels` | 回归、假设检验、预测区间 |
| `pol.conflict` | 政治矛盾 | `networkx/networkx` | 双方及关系 |
| `fact.market` | 客观事实 · 可追溯数据 | `akfamily/akshare` | 数据条目与来源 |
| `econ.admin` | 市场管理 | `lballabio/QuantLib` | 定价、风险、约束 |
| `bio.record` | 生物 | `biopython/biopython` | 已公开分类、注释、安全边界 |
| `chem.class` | 化学 | `rdkit/rdkit` | 结构、描述符、性质分类 |

近现代和当代中文、仍在版权期内的英文作品，不建立条目，除非另行提供使用权。OpenStax 教材进入商业用途时，条目只保留概念名和出处，不保留教材正文。

后续喂入的资料只增加条目，不修改 `agent.main` 的性格。

## 5. 契约

字段在本文版本冻结。以后只能增加可选字段，不能改变已有字段的含义。

### 5.1 输入

| 字段 | 含义 |
| --- | --- |
| `goal` | 要决定的目标 |
| `constraints` | 约束 |
| `budget` | 预算上限 |
| `freeze_notice` | 外部给出的冻结说明。可以没有 |
| `stop_notice` | 外部给出的叫停说明。可以没有 |
| `task_results` | 已发出任务卡的返回结果。开始时为空 |

### 5.2 决定记录

文件写在 `decisions/<decision_id>.json`。

| 字段 | 含义 |
| --- | --- |
| `decision_id` | 决定标识 |
| `agent_id` | 固定为 `agent.main` |
| `affected` | 受影响的人 |
| `facts` | 事实列表。每条含 `statement`、`status`、`source_id` |
| `opposition` | 对立面。至少一条 |
| `keep` | 保留什么 |
| `drop` | 放弃什么。没有放弃时为「不放弃」 |
| `freeze` | 冻结说明。没有时为空字符串 |
| `stop` | 叫停说明。没有时为空字符串 |
| `review` | 复盘。未结束时为空字符串 |
| `status` | `draft`、`frozen`、`accepted`、`rejected` 之一 |

`facts[].status` 只取 `sourced` 或 `unverified`。`sourced` 必须有 `source_id`，且该标识存在于知识图谱。`unverified` 的 `statement` 以「未证实」开头。

### 5.3 任务卡

主 Agent 发出的任务卡写在 `decisions/<decision_id>/tasks/<task_id>.json`。

| 字段 | 含义 |
| --- | --- |
| `task_id` | 任务标识 |
| `decision_id` | 所属决定 |
| `assignee_id` | 唯一执行者 |
| `goal` | 这一张卡的目标 |
| `allow_paths` | 允许修改的目录 |
| `deny_paths` | 禁止修改的目录，至少包含 `.git` |
| `done_when` | 怎样算做完 |
| `budget` | 分配给这一张卡的预算 |

一张决定可以有多张任务卡。每张卡的 `assignee_id` 只有一个。主 Agent 不把自己写成 `assignee_id`。

### 5.4 最终结果

写在 `decisions/<decision_id>/result.json`。

| 字段 | 含义 |
| --- | --- |
| `decision_id` | 所属决定 |
| `status` | 与决定记录的最终状态相同 |
| `text` | 给人读的正文，包含受影响的人、事实、对立面、保留、放弃 |

## 6. 程序位置

```text
badrr/
  docs/主Agent技术说明.md
  contracts/main-agent-input.schema.json
  contracts/decision.schema.json
  contracts/task-card.schema.json
  contracts/result.schema.json
  registry/main-agent.json
  registry/knowledge/<node_id>.json
  decisions/
  control/src/main/          TypeScript：主 Agent
  supervisor/                Rust：只监督主 Agent 进程的拉起、超时和预算
```

`control/src/main/` 之外的 Agent 实现不在本文验收。

Rust 监督库对主 Agent 只提供三项：拉起进程、超时结束、预算耗尽结束。它不改写决定记录，不填写五栏，不选择执行者。

## 7. 验收清单

| 编号 | 验收项 | 通过标准 |
| --- | --- | --- |
| M1 | 唯一性 | 运行结果里主 Agent 标识只有 `agent.main` |
| M2 | 性格 | `registry/main-agent.json` 四栏与第 2 节一致。测试尝试改写四栏时，程序拒绝 |
| M3 | 五栏 | 一份样例目标产生的决定记录包含受影响的人、事实、对立面、保留、放弃 |
| M4 | 未证实 | 图谱中不存在的主张，事实状态为 `unverified`，正文以「未证实」开头 |
| M5 | 有出处 | 状态为 `sourced` 的事实，其 `source_id` 能在 `registry/knowledge/` 找到 |
| M6 | 不成决定 | 事实为空或对立面为空时，状态不能是 `accepted` |
| M7 | 冻结 | 输入含冻结说明时，状态为 `frozen`。写明例外和理由之前不能变为 `accepted` |
| M8 | 叫停 | 输入含叫停说明时，状态为 `rejected`，复盘栏非空 |
| M9 | 任务卡 | 每张卡只有一个 `assignee_id`，且不是 `agent.main`。`deny_paths` 含 `.git` |
| M10 | 不实施 | `control/src/main/` 中没有读文件改写、命令执行或技能调用 |
| M11 | 语言 | 主 Agent 程序是 TypeScript，记录契约是 JSON Schema，进程监督是 Rust |
| M12 | 监督边界 | 超时或预算耗尽后，不存在状态为 `accepted` 的未完成决定 |
| M13 | 最终结果 | `result.json` 的正文同时含受影响的人、事实、对立面、保留、放弃 |

M1 到 M13 全部通过，主 Agent 本版本验收通过。

## 8. 签收

| 角色 | 姓名 | 日期 | 结论 |
| --- | --- | --- | --- |
| 提出人 | | | |
| 验收人 | | | |

签收「通过」只覆盖本版本的主 Agent。其他层另写技术说明后再验收。
