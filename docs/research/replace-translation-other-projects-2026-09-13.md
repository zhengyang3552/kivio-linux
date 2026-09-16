# 原位替换翻译：其他项目源码调查

调查日期：2026-09-13。范围：原文残留、背景损坏、字体与排版。只阅读官方仓库、源码与说明，没有运行这些项目或比较推理耗时；本文的“建议”不是实测结论，也不涉及修改本项目产品代码。

## 结论

三个项目显示，擦除和排版必须分别解决：文字像素掩膜、背景恢复区域、译文可排版区域承担不同职责。漫画项目提供精细 mask 与模型修复的实例；桌面屏幕项目提供不透明覆盖、有限外扩、字号分组和字体回退的实例。不存在一个可直接移植、同时解决所有场景的方案。

当前项目曾因残留与逐行碎片效果撤掉 MI-GAN，因此不能把“重新接模型”当作结论。应先确定文字覆盖范围、背景保护边界、恢复后合成方式以及译文真实宽高，再比较纯色恢复和模型恢复。模型不能修复没有进入 mask 的字，也不负责排版。

## 1. manga-image-translator：文字 mask → 修复 → 独立渲染

核验版本：[`95227a2bb0fd306cd4f0c104d57284026f991b3a`](https://github.com/zyddnys/manga-image-translator/tree/95227a2bb0fd306cd4f0c104d57284026f991b3a)。

**源码证据。** mask refinement 接收原图、检测 mask 和 text regions，把区域拆回文字行，调用 `complete_mask`，输出恢复到原分辨率的二值掩膜。`complete_mask` 使用连通域及其与文字行的重合度过滤候选，再按文字尺寸和 `dilation_offset` 膨胀，最终还有一层可配置卷积核膨胀。因此 OCR/翻译区域并不直接等于整块涂色区域。[入口](https://github.com/zyddnys/manga-image-translator/blob/95227a2bb0fd306cd4f0c104d57284026f991b3a/manga_translator/mask_refinement/__init__.py#L9)、[连通域及膨胀](https://github.com/zyddnys/manga-image-translator/blob/95227a2bb0fd306cd4f0c104d57284026f991b3a/manga_translator/mask_refinement/text_mask_utils.py#L96)。

LaMa MPE 路径保留原始分辨率 mask，必要时缩小图像进行推理，再放大预测。最终使用 `预测 * mask + 原图 * (1-mask)` 合成，限制模型结果只进入 mask。该实现有 CPU/CUDA/MPS/XPU 分支与 CUDA 精度配置；输入尺寸控制属于真实部署约束，但代码不能证明本机速度。[修复及最终合成](https://github.com/zyddnys/manga-image-translator/blob/95227a2bb0fd306cd4f0c104d57284026f991b3a/manga_translator/inpainting/inpainting_lama_mpe.py#L56)。

排版阶段独立计算字体与渲染区域；横排按字形宽度、词和连字符处理换行，另有竖排路径。区域可随译文长度/字号扩大，说明它不是仅将译文塞进原 OCR 矩形。[区域调整](https://github.com/zyddnys/manga-image-translator/blob/95227a2bb0fd306cd4f0c104d57284026f991b3a/manga_translator/rendering/__init__.py#L48)、[横排计算](https://github.com/zyddnys/manga-image-translator/blob/95227a2bb0fd306cd4f0c104d57284026f991b3a/manga_translator/rendering/text_render.py#L609)。

**可借鉴 / 不能照搬。** 借鉴检测 mask 的细化、有限膨胀与原分辨率合成。细 mask 缺失的抗锯齿仍会原样留下，扩大 mask 又可能伤及细线，因此不能只调大一个全局数值。漫画文字区域可扩张不等于桌面按钮和表格单元格可扩张；迁移时必须限制到真实容器与邻接保护区。这些属于基于源码的工程推论。

## 2. BallonsTranslator：按背景选择恢复方式，保留人工修正能力

核验版本：[`84ba500ea1a4f523ca79f1c77d8c642eea3d1d07`](https://github.com/dmMaze/BallonsTranslator/tree/84ba500ea1a4f523ca79f1c77d8c642eea3d1d07)。

**源码证据。** `InpainterBase` 默认支持按块修复，按 `ratio=1.7` 扩展上下文窗口。启用背景检查时，先提取气泡/非文字区域，计算背景中位色和标准差；足够均匀才走纯色填充，否则调用修复器。另有可配置的 mask 与检测框相交过滤。这证明“纯色快路径 + 复杂区域修复”可以共存，而非二选一。[路由及局部窗口](https://github.com/dmMaze/BallonsTranslator/blob/84ba500ea1a4f523ca79f1c77d8c642eea3d1d07/ballontranslator/modules/inpaint/base.py#L126)、[mask 限域](https://github.com/dmMaze/BallonsTranslator/blob/84ba500ea1a4f523ca79f1c77d8c642eea3d1d07/ballontranslator/modules/inpaint/base.py#L20)。

可选实现包括 OpenCV NS、PatchMatch、AOT、LaMa。AOT 预处理保留原图和二值 mask，预测后只替换 mask 内像素；LaMa 路径通过 padding 对齐，代码明确避免为对齐额外重采样。公共层会在 CUDA 内存不足后重试，再回退 CPU。[具体修复器](https://github.com/dmMaze/BallonsTranslator/blob/84ba500ea1a4f523ca79f1c77d8c642eea3d1d07/ballontranslator/modules/inpaint/inpaint_default.py#L128)、[LaMa 对齐](https://github.com/dmMaze/BallonsTranslator/blob/84ba500ea1a4f523ca79f1c77d8c642eea3d1d07/ballontranslator/modules/inpaint/inpaint_default.py#L227)、[内存回退](https://github.com/dmMaze/BallonsTranslator/blob/84ba500ea1a4f523ca79f1c77d8c642eea3d1d07/ballontranslator/modules/inpaint/base.py#L95)。

排版函数接收气泡 mask、单词宽度、行高、间距、源行宽度和对齐方式，利用 mask 边界安排居中或左右对齐文字；因此排版区域是形状约束。官方说明同时提供掩膜编辑、修复画笔和富文本编辑，承认复杂背景与文字组合仍需人工处理。[排版源码](https://github.com/dmMaze/BallonsTranslator/blob/84ba500ea1a4f523ca79f1c77d8c642eea3d1d07/ballontranslator/utils/text_layout.py#L367)、[官方功能与限制](https://github.com/dmMaze/BallonsTranslator/blob/84ba500ea1a4f523ca79f1c77d8c642eea3d1d07/README.md)。

**可借鉴 / 不能照搬。** 最值得借鉴的是先判定背景是否适合填色，并让模型看到比最终改动区更大的上下文。桌面截图的卡片边界、细分隔线、图标和阴影不是漫画气泡；气泡检测、阈值和窗口倍数都需要屏幕样本验证。其 Qt 编辑器也不能直接解决本项目 Canvas 的字形量度问题。

## 3. Nimbus ScreenTranslator：针对屏幕覆盖的实用防漏，但仍非背景重建

核验版本：[`3e7529aadde5f2ce2ac0764f1104e4eb0627c3b0`](https://github.com/nimbus-translate/screen-translator/tree/3e7529aadde5f2ce2ac0764f1104e4eb0627c3b0)。这是 Windows 截图、OCR、翻译与原位覆盖项目，场景更接近桌面 UI。[官方说明](https://github.com/nimbus-translate/screen-translator/blob/3e7529aadde5f2ce2ac0764f1104e4eb0627c3b0/README.md)。

**源码证据。** 自动背景模式按检测背景色画矩形，alpha 固定 255；背景未知则按字色选择黑白。擦除框按行高外扩，边距限制在 2–5 像素，并限制到窗口内。源码注释明确指出抗锯齿、阴影、下划线、圆角和半透明会导致原文残留。这是有针对性的覆盖方案，不包含该绘制路径中的纹理背景修复。[绘制逻辑](https://github.com/nimbus-translate/screen-translator/blob/3e7529aadde5f2ce2ac0764f1104e4eb0627c3b0/ui/translation_overlay.py#L375)、[外扩](https://github.com/nimbus-translate/screen-translator/blob/3e7529aadde5f2ce2ac0764f1104e4eb0627c3b0/ui/translation_overlay.py#L454)。

它按相近源行高度组织字号；字体使用 CJK 回退链。`_fit_font` 用 `QFontMetrics` 检查行高、单行宽度或多行总高，逐步缩字号。但到最小字号仍可返回不满足约束的字体，绘制再使用 clip；代码没有证明“全文完整且不溢出”。此外注释提到横向压缩，此函数实际没有设置字体 stretch，判断必须以代码为准。[分组](https://github.com/nimbus-translate/screen-translator/blob/3e7529aadde5f2ce2ac0764f1104e4eb0627c3b0/ui/translation_overlay.py#L113)、[字体适配与回退](https://github.com/nimbus-translate/screen-translator/blob/3e7529aadde5f2ce2ac0764f1104e4eb0627c3b0/ui/translation_overlay.py#L461)。

**可借鉴 / 不能照搬。** 借鉴完全覆盖文字核心、考虑字形外围像素、同级字号一致及 CJK 回退。纯色矩形仍会压平渐变与纹理；全局外扩可能擦掉邻近边框；最小字号 + 裁切不应作为“排版成功”。未运行其测试，不能把仓库中的测试文件等同于跨设备质量保证。

## 对本项目的调查建议（尚未实施）

| 问题 | 优先核查/设计 | 不足以解决问题的做法 |
| --- | --- | --- |
| 原文残留 | 保存原图、文字 mask、实际改动 mask、擦除结果；检查细描边、阴影、缩放后的 mask 对齐，以及合成是否把原字重新混回 | 只扩大 OCR/翻译框；只更换修复模型 |
| 背景被盖坏 | 区分纯色/渐变/纹理；取样限定在同一背景容器；保护图标、卡片边、分隔线；区分模型上下文窗口和最终回写区域 | 从整组外圈直接选一种背景色；把模型输出整块贴回 |
| 字体与排版 | 用最终字体和实际行高量度；同时验证宽高、完整性、容器边界；保持同级字号并明确无法容纳时的处理策略 | token 全部消费就判成功；统一字号；靠裁切隐藏溢出 |

建议评估集至少包含：浅色细字、深色小卡片、渐变按钮、表格细线、图片上的字、长译文、混合中英、DPI 缩放。分别报告原字残留、非文字区域改动、译文溢出/截断和耗时分布；不能只看最后一张合成图。先固定这些中间证据与验收条件，再决定是否恢复模型路径。

## 部署候选补充

如果之后重新比较轻量修复模型，MI-GAN 官方仓库提供 ONNX 导出与推理管线，值得列为候选；模型输入 mask 的极性与固定尺寸预处理必须以官方示例核对，不能沿用其他实现的习惯。此次未运行模型，因此没有本机延迟、质量或“优于 LaMa”的结论。[MI-GAN 官方仓库](https://github.com/Picsart-AI-Research/MI-GAN)、[LaMa 官方仓库](https://github.com/advimman/lama)。

本文链接固定到本次核验 commit，模型候选链接除外。分析以技术思路和行为对照为目的，没有复制外部实现进入本项目。

## 本地实现对照与验证记录

本节整合同次调查中主代理提供的本地源码检查与临时回归结果，外部项目未参与运行对照。

**当前链路。** RapidOCR → 几何分组/排版槽位 → 翻译与按组 `plate_fill` 擦除并行 → Canvas 绘制。生产擦除采用外圈中位色、垂直渐变、分隔线恢复和边缘混合，没有运行中的 inpaint 模型路径。[调度](<E:/ZM database/kivioC/src-tauri/src/lens_commands.rs:2021>)、[并行处理](<E:/ZM database/kivioC/src-tauri/src/lens_commands.rs:2134>)、[填充](<E:/ZM database/kivioC/src-tauri/src/replace_translation/mask.rs:69>)、[取样](<E:/ZM database/kivioC/src-tauri/src/replace_translation/mask.rs:267>)、[合成](<E:/ZM database/kivioC/src-tauri/src/replace_translation/mask.rs:378>)。

历史提交 `21732d37`（2026-08-26，`feat(replace): cover original text with a group-level plate instead of MI-GAN`）说明，旧方案也存在 glyph mask 漏掉抗锯齿、逐行灰条与译文碎片问题。旧路径曾按低复杂度填色、其他情况走 MI-GAN。因此需要吸取旧路径的 mask/几何缺陷，不能仅恢复模型调用。

**已执行的合成回归。** 主代理临时构造输入验证了四类故障，随后按用户“不改”的要求撤回临时测试与产品改动。这些是函数级构造样例，不是真实截图的视觉复现：

| 构造输入 | 实际结果 | 含义 |
| --- | --- | --- |
| 背景灰度 245、文字浅灰边缘 230 | 边缘混合后为 237 | 擦除合成可把浅灰原字重新混回 |
| 小卡片灰度 24、外圈灰度 250 | 卡片被填成 250 | 外圈取样可跨越背景容器，整块盖错色 |
| 2 px 宽槽、约 8.795 px 宽字形 | 仍被判定可容纳 | token 消费完成不等于水平适配 |
| 8 px 高槽、约 28.30 px 高文字 | 仍被判定可容纳 | 完成标志没有保证垂直适配 |

后端生成源文字几何，前端 `complete` 主要检查 tokens 是否耗尽；字体样式传递只有源字号/颜色，并使用 `system-ui`，没有还原源字体家族、字重或旋转。原文墨迹锚点与 Canvas `top` 字体排版框之间可能不一致，这是源码风险，尚未通过最终画面对齐实测。[后端几何](<E:/ZM database/kivioC/src-tauri/src/replace_translation/layout.rs:280>)、[Canvas 样式](<E:/ZM database/kivioC/src/lens/ReplaceTranslateOverlay.tsx:59>)、[绘制](<E:/ZM database/kivioC/src/lens/ReplaceTranslateOverlay.tsx:80>)、[定位](<E:/ZM database/kivioC/src/lens/ReplaceTranslateOverlay.tsx:183>)、[适配入口](<E:/ZM database/kivioC/src/lens/replaceTextLayout.ts:102>)、[完成判断](<E:/ZM database/kivioC/src/lens/replaceTextLayout.ts:133>)、[字号范围](<E:/ZM database/kivioC/src/lens/replaceTextLayout.ts:153>)。

**现有检查的盲区。** 残影指标按输出行中位数判断并主要查看 OCR 框内，因此均匀但错误的底色可能通过，也不充分覆盖框外抗锯齿。前端 benchmark 主要验证指标函数，不能替代真实浏览器、字体回退及 DPI 下的最终合成图验收。[视觉指标](<E:/ZM database/kivioC/src-tauri/src/replace_translation/visual_fixtures.rs:222>)。

后续顺序建议：先建立真实截图分场景 baseline，保留原图/掩膜/擦除图/最终图以区分漏 OCR、漏 mask、合成混回和背景错采样；再解决擦除边界、排版容器与严格宽高适配；最后在固定样本上受控比较局部模型修复。以上均为调查建议，本次没有实施。

## 后续实现记录（2026-09-13，用户调用 implement 后）

上一节记录的是调研时的状态。后续授权的实现已处理：

- 擦除区保持不透明，去掉将浅色原字混回的边缘羽化。
- 文字框内主色与紧邻框外采样共同确认局部纯色，避免小卡片使用外层页面颜色；未通过验证时沿用外圈采样。
- 环带/行间采样保留坐标，增加二维线性背景拟合，要求至少 90% 样本与拟合颜色一致；支持横向和斜向渐变。无法拟合时保留中位色/上下渐变回退。
- 从实际文字锚点计算可用空间，同时检查完整性、宽度和高度；Canvas 实际墨迹边界参与量度与对齐。
- 缩小文字按最终字号重新量度并直接绘制，移除中间位图缩放。

验证：相关用例先失败再修复；最终前端全量 204 个文件、1552 项测试通过，替换翻译相关 Rust 30 项通过，视觉指标测试 10 项通过，TypeScript 和相关文件 ESLint 通过。浏览器已人工检查实际 Overlay 组件的中英文、段落、窄标签、2× 自然像素及叠加附标示例。浏览器输入为构造样例，未把它当作真实 OCR 全链路验收。

Rust 全量结果：2372 项通过、45 项忽略、4 项失败，分别位于未修改的模型元数据、视觉模型选择和路径测试。前端第一次全量运行有一个聊天性能用例超时，单独复跑及最终全量复跑均通过。

### Standards

无阻断发现。已更新 `CLAUDE.md` 与擦除模块中陈旧的羽化说明。采样 tuple 的可读性是非阻断建议，当前没有为此扩大重构范围。

### Spec

最初发现实际字形墨迹未参与严格适配，已补充实际边界量度与高附标回归；复审待解决发现为 0。

剩余限制：本次没有恢复模型修复，复杂纹理仍采用近似背景；OCR 漏检仍会留下未识别文字；原字体家族、字重与旋转未还原；极长译文仍可能缩到较小字号。
