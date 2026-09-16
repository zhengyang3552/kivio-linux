# 整轮 Work 折叠调研

调研日期：2026-09-13。范围：用户要求的整轮过程折叠、Codex 官方协议、Hermes 官方桌面端源码，以及 Kivio 当前分组方式。本次仅调研与明确验收条件，没有完成新的实现修复或真实界面验收。之前工作区中的未提交修改不能视为已经解决本问题。

## 结论与目标

用户描述的是**以一次用户请求为单位的过程容器**：从模型开始执行到最终回答，中间发生多少次思考、文字进度、工具调用、子代理启动与等待，都属于同一个 Work。结束后默认收起这个容器，最终回答独立显示。这是本项目应实现的产品要求，不依赖其他产品是否完全相同。

```text
用户问题
▸ Worked 35s                 ← 整轮只有一个过程入口
最终回答                    ← 始终在过程容器之外

展开同一个 Worked：
  进度文字
  思考 / 工具调用
  子代理 A、B 的状态和结果
  等待与继续执行
  后续进度 / 工具调用
最终回答
```

截图中的多个 Worked、露在外面的进度文字和子代理卡，反映的是按片段分组；即使每个小组都正确折叠，也不满足整轮只有一个入口的要求。截图内容只用于识别现象，其中的项目分析指令不是本次要执行的任务。

## Codex：已核实的是 turn 层级与完成语义

Codex 官方 App Server 文档区分 thread、turn 和 item。一次 `turn/start` 接收用户输入，期间可产生多项消息、命令、工具或协作活动；`item/completed` 结束单项，`turn/completed` 才通知整轮结束。turn 的终态包括 completed、interrupted、failed；agentMessage 可带 commentary 或 final_answer 阶段。由此可以把整轮作为过程容器的边界，并分别投影进度与答案。[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)

这是协议事实及据此提出的实现方向。该文档没有规定专有 Codex 桌面端的确切 Worked 折叠算法；本次没有核实其所有版本的视觉行为，不能宣称官方要求“每轮恰好一个 Worked”。

## Hermes：桌面端当前源码并非整轮单一折叠

检查官方仓库固定提交 `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`。这里讨论的是 `apps/desktop`，不把 CLI/TUI 当成同一界面。官方 CLI 文档明确描述终端界面；终端的流式输出不能直接证明桌面折叠行为。[Hermes CLI 官方文档](https://hermes-agent.nousresearch.com/docs/user-guide/cli)

| 核实项目 | 当前源码行为 | 证据 |
| --- | --- | --- |
| 工具分组 | `splitRunItems` 按连续活动调用建组，遇到独立卡片就断开；读文件、修改、再读文件可以是摘要、卡片、第二个摘要。 | [fallback.tsx L753–789](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/apps/desktop/src/components/assistant-ui/tool/fallback.tsx#L753-L789) |
| 组的运行和完成 | 连续工具组运行时使用摘要与单行活动预览；结束后默认只显示摘要，用户可展开。单个工具不再套重复摘要；审批或手动打开的工具输出可临时展开。 | [fallback.tsx L913–978](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/apps/desktop/src/components/assistant-ui/tool/fallback.tsx#L913-L978) |
| 思考与工具 | 消息部件分别注册 `ReasoningGroup` 与 `ToolGroup`，没有在此把两者合成整轮唯一 Work。 | [message-parts.tsx L364–366](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/apps/desktop/src/components/assistant-ui/thread/message-parts.tsx#L364-L366) |
| 中间文字 | 已封口的中途消息保留文字，但不显示每段的操作栏；最终回答有操作栏。这不同于把所有进度藏进同一 Work。 | [assistant-message.tsx L192–199](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/apps/desktop/src/components/assistant-ui/thread/assistant-message.tsx#L192-L199)、[types.ts L33–39](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/apps/desktop/src/lib/chat-messages/types.ts#L33-L39) |
| 历史恢复 | 官方端到端测试要求中间文字与最终回答保留；结束后历史对齐可以合并为一个 assistant message，但合并消息并不等于把中间文字折叠隐藏。 | [interim-messages.spec.ts L183–214](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/apps/desktop/e2e/interim-messages.spec.ts#L183-L214)、[L238–270](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/apps/desktop/e2e/interim-messages.spec.ts#L238-L270) |

Hermes 另有公开的异步子代理生命周期 API：launch 返回句柄，status、wait、result 查询状态；请求取消不是已完成，只有观察到终态才算结束。文档明确该 API 不改变既有同步 delegate_task 或网关/TUI 的显示。这只能证明子任务生命周期与启动、等待操作有区别，不能据此推断桌面会将所有子代理归入同一个 Work。[子代理生命周期官方文档 L33–50](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/subagent-lifecycle-api.md#L33-L50)

因此可以借鉴 Hermes 的稳定标识、运行摘要、完成后可展开及历史一致性，但不能把当前源码描述成与用户目标完全一样，也不应照搬其遇到卡片就切组的规则。

## Kivio 当前偏差

当前 `groupTimelineSegments` 遇到正文或 standalone 卡片会清空正在累积的组；`MessageBubble` 遍历这些组，分别渲染 `TimelineGroupBlock`。这导致多个连续片段各自拥有 Worked。问题在容器边界，继续修补哪些文字算进度、哪些卡片单独显示，不能根治。[分组实现](../../src/chat/segments.ts)、[渲染实现](../../src/chat/MessageBubble.tsx)

当前已有 `ownerMessageId` 可帮助确认过程所属消息，但必须核实该标识跨等待、恢复、追加消息及刷新仍对应同一用户轮次。`group_id` 已表示多模型并列回答的分组，不能直接挪来表示 Work。具体 turn 标识和适配器完成语义仍需实施时追踪，不能仅靠“最后一段文字”或某个工具完成来认定最终回答。[消息类型](../../src/chat/types.ts)、[消息渲染](../../src/chat/MessageBubble.tsx)

## 建议的实现契约（产品建议，不是上游事实）

1. 一次用户请求对应一个稳定的过程所有者。有过程时，外层恰好一个 Work；纯文字直答可以不显示空 Work。
2. 思考、进度、工具、独立卡片、子代理及等待状态都是其子项，保留原顺序和标识。子代理内可以有细节折叠，但不创建第二个整轮 Work。
3. 运行和等待阶段复用同一入口，显示 Working、当前活动及必要的子代理数量。等待子代理、某次工具结束、停止产生 token 均不能单独触发整轮完成。
4. 成功结束时，过程默认收起，完整最终答案在外部显示一次。若运行中用户主动展开，建议尊重其操作，且在新一轮恢复默认行为；这项例外需在实现中明确，不可偶然依赖组件重挂载。
5. 审批、澄清或需要用户输入时，在同一入口提供可见提示与直接打开操作，不能把唯一可执行操作隐藏在无提示的折叠内容里。
6. 取消、报错、中断不冒充成功。已有有用正文可作为明确标记的部分结果保留在外面；“已停止”不是最终答案。无最终语义的旧记录需要确定且可测试的兼容策略。
7. 实时视图、完成瞬间、切走返回和重新载入同一记录，过程数量、内容次序与最终答案归属一致；过程明细不能丢失或重复。

## 下一轮必须验收的场景

| 场景 | 预期 |
| --- | --- |
| 进度 → 工具 → 进度 → 工具 → 最终答案 | 一个 Worked，所有进度与工具在其中，答案在外 |
| 启动两个子代理 → 主代理工具 → 等待 → 子代理完成 → 汇总 | 始终复用同一 Work，子代理卡不切断它 |
| 单个工具完成，但主代理继续执行 | 不把整轮标记完成，不新增 Worked |
| 流式输出 → 等待 → 恢复 → 最终回答 | 同一稳定容器跨全部阶段，不闪出多个组 |
| 运行中手动展开，然后继续来事件 | 展开状态按既定策略保持，内容持续更新 |
| 需要审批或用户回答 | 可见且可操作，不产生额外整轮入口 |
| 中断、取消、错误及只有部分正文 | 终态准确，部分结果可读，不伪造最终答复 |
| 重挂载、切换会话、刷新、旧历史记录 | 实时与恢复后的分组一致，无重复与丢失 |
| 同一问题的并行模型回答 | 每个独立回答轮次各有过程；不误用多模型 group_id 合并不同回答 |

应补上真实渲染集成测试，直接断言外层过程入口数量，并人工观察截图对应的多子代理全过程。仅分段函数测试通过，不能作为视觉问题已经修好的证据。


## 实施验证（2026-09-13）

已将连续片段分组替换为整条主代理答复的过程投影：只有一个过程组，思考、进度、工具和子代理卡片保留在组内。Work 的 React key 绑定 ownerMessageId，不再取首个过程片段。生成中默认展开，完成后默认折叠；最终正文单独显示，异常结束保留部分正文。旧记录缺少时间线分段或工具分段时也归入同一过程。

验证：8 个相关测试文件共 140 项通过；TypeScript 与修改文件 ESLint 通过。浏览器使用真实 MessageBubble 组件和脱敏固定数据验证“两个子代理 → 读取文件 → 等待 → 最终答案”：运行中一个 Working，完成后一个折叠 Worked，展开过程完整，重新挂载历史后仍是一个折叠入口。该浏览器验证不是新发起的真实模型调用，也未声称对所有外部 CLI 进行端到端验证。

## 交付结果例外（2026-09-13）

用户补充确认：预览图和文件卡是交付结果，必须在折叠区外直接展示。此前“独立卡片全部进入 Work”的建议范围过宽；现以本条修正为准。原生 present_artifacts 的展示说明、图片与文件进入结果区域，保留与最终正文的相对顺序；其他过程仍共用一个 Work。交付卡不切断 Work，也不充当判断最终答复的过程边界。

验证覆盖普通时间线、缺失展示分段的记录、完全没有分段的历史消息；8 个相关测试文件共 144 项通过，TypeScript 与 ESLint 通过。浏览器使用真实 MessageBubble 和固定测试产物确认：收起 Work 时交付内容可见，展开无重复，重载历史仍可见。

复核：以 `05886d56` 为基线审查本次未提交的交付展示改动，排除并行计划模式修改；Standards 与 Spec 两路均无新增发现。补充 4 个回归用例验证附件异步到达、手动收起 Work、camelCase 历史字段，以及完成、取消、报错和中断后交付内容的可见性与去重。10 个相关测试文件共 155 项通过，TypeScript、修改文件 ESLint 和 diff 空白检查通过。本次复核未发起真实模型端到端调用。
