# 回顾短片 · 首版交付说明

**验收状态（2026-10-15）：** 用户在 iPhone SE 真机确认启动/播放、任意拖动恢复、坏链占位不断音并进入后续视频、PNG 分享均正常；助手从应用 Documents 取回真实 PNG，检查为 720×1080 且内容对应目标时间。追加 iOS MP4 离线导出后，TypeScript、lint、12 项测试通过；用户运行 macOS 原生编码测试成功，并在重新构建客户端、修复素材生命周期及 AAC 有效时长检查后确认 App 内 MP4 导出成功。尚未逐帧核对 MP4 与预览一致性，取消/重新导出的真机验收和录屏仍待完成；音画延迟/帧率尚未量化。

## a. 架构与取舍

**模型。** 原 manifest 是视频/文字/照片视觉轨 `timeline[]` 和独立背景音轨 `audio`；每段保留原 `startTime / duration`，启动检查顺序、重叠、ID、转场与结束范围。`evaluateTimeline(t)` 给出一至两个视觉层（含段内时间、透明度、横向位移）。转场采用进入新段的前 `transition.duration` 秒：上一段停在末帧，与新段重叠，不改变原 48 秒长度。段内运镜、照片交叉淡化、头像错峰、数字/进度条等均为 `t` 的确定性函数。可选 SFX 此版未混音；视频原轨按正常片段 `hasAudio:false` 静音。

**主时钟。** `expo-audio` 播放 pack 的 BGM。RAF 只调度取样，每次读取原生 `player.currentTime`，不使用 RAF 时间戳、墙钟差值、`withTiming / withRepeat` 或定时串段。画面上限 30 fps，JS 忙时直接跳到最新音频位置，不累积掉帧造成的漂移。音频暂停/缓冲则位置不前进；原音乐长约 194 秒，达到 manifest 的 48 秒时暂停并保持最后一帧（停止点存在一次调度的延迟）。

**Seek。** 开始拖动先记住是否播放并暂停，拖动时仅用目标 `t` 预览，结束以零 iOS 容差 `await seekTo(t,0,0)`，确认原生位置后再恢复。Seek 队列与 generation 防止较早异步完成覆盖较新请求；对齐中禁止追加 UI 操作。应用进入后台暂停，不靠墙钟追赶。音频是唯一时基，帧缓存按 `floor(localTime × 12)` 取图，没有第二个自由运行的视频时钟；视频量化误差小于一个 12 fps 帧间隔，未实测端到端设备延迟，不声称样本级同步。

**Skia。** 使用工程已有 `react-native-skia@3.4.4`（Skia 项目的当前包），不是纯 RN View 动画替代。主画面的图像、文字、统计图和转场均在 Skia 内。预览记录 `SkPicture`，PNG 离屏输出直接调用同一个 `drawFrame(canvas,t,media)`。这个 Skia 版本原生侧不再提供旧 `useVideo`；通过 `expo-video.generateThumbnailsAsync` 解原视频，原生 ImageManipulator **不添加任何变换**，仅将图像引用序列化成 PNG，交给 Skia 解码。按 12 fps、最大 360×640 分批缓存 66 帧；资源转换保留真实内容，不做生成式处理。代价是准备耗时、内存和视频帧率，不是生产级解码方案。

**失败隔离。** 各图像独立加载、记录错误，无法解码的图片有非黑屏占位。坏视频从首次进入即显示 manifest 原照片占位；远端 HEAD 检测失败或超过 4 秒会显示原因，检测从不阻塞音频。`setTimeout` 仅限制网络 I/O 和本地解码器就绪等待（15 秒），不驱动叙事。坏段保留 6 秒占位而非压缩时间轴，符合题目等价选项；随后正常视频继续。只支持本 pack 的本地视频帧解码，远端视频通用下载/解码未实现，成功远端 URL 也会明确报告不支持并占位。

**MP4 追加实现。** 保留 PNG 分享，新增薄本地 Expo module `modules/memories-video`，仅支持 iOS，旧开发客户端需要重新构建。RN 固定以 `t=n/30` 调用同一 `drawFrame`，将 720×1080 BGRA 像素写入单个可复用临时文件；原生按整数 PTS `CMTime(n,30)` 写入 H.264，完整输出 1,440 帧/48 秒。每次 append 都等待原生接收，编码器未就绪则让出 JS 并重试同一帧，30 秒背压超时明确报错；不会先存储整片未压缩帧。BGM 原素材为 MP3，不能直接 passthrough 到 AVFoundation MP4，先裁切并转 AAC/M4A，再通过 `AVMutableComposition` 无二次视频编码合入 MP4。坏链照片占位和正常片段的 12 fps 帧缓存与预览一致；不新增 SFX，正常视频按 manifest 静音。输出到 Documents，再系统分享，分享不可用时明确保留路径。无服务端渲染，也不是实时屏幕录制。

**取消与资源。** 页面展示帧进度、音频合成状态；导出期间暂停预览并禁止播放/Seek/其他导出，等待本地视频缓存准备完毕才允许开始。取消、离开前台或卸载页面均触发中止，销毁 Skia 离屏面、取消原生 writer/export session、删除单帧临时文件和未完成 MP4；成功的视频保留。导出前检查至少 150 MB 磁盘余量；内存只增加离屏面、当前 BGRA 帧和编码器缓冲，不将整片 1,440 帧常驻内存。原生模块通过 Expo 自动链接，不手改生成的 iOS 工程，不增加第三方编码依赖。Android/Web 显式禁用 MP4 按钮，不将 PNG 假称视频。

**音轨边界。** AAC 转码阶段额外保留 0.25 秒尾量，避免 iOS 编码包边界/尾部 padding 使精确裁切后的有效音轨略短于目标；最终合轨仍仅插入 48 秒，不延长视频、不静默补齐短音乐。按 AAC track 的实际 `timeRange` 检查可用时长，并从有效起点插入，日志记录音视频轨范围；缺轨、取消或短音轨分别报错。合轨源 `AVURLAsset` 保留至导出结束，避免 track 的弱父引用失效。macOS 原生色块测试及 iOS App 内实际 MP4 导出均已由用户确认成功。

## b. AI 工作流

使用 **VS Code 的 Copilot SDK AI assistant**；未使用额外 agent。先读候选要求、manifest、现有包/路由，向用户确认可访问版本文档和 PNG / MP4 边界；并行查 Expo 57 官方文档与本地类型/原生源码，之后实现时间轴 → 资源与 Skia → 音频交互 → 导出 → 测试。采纳 AI 生成的纯函数时间轴、共享渲染器与测试，并通过 typecheck/lint/边界采样验证。否掉旧版 Skia `useVideo`/默认字体 API、已弃用 video-thumbnails、定时串段与伪 MP4“导出”：它们分别与实际库版本或任务契约不符。所有新增 Expo 包通过 `expo install` 解析版本；未重新安装已正常工作的 Expo/Skia。

## c. 生产规模

几十段素材应做运行时 schema 验证、资源下载/解码优先级、前后窗口预取、尺寸分级、内存预算和 LRU。视频改为解码器提供时间戳视频纹理到 Skia 的零拷贝接口，不缓存整段 PNG。将 `t` 和合成参数迁移到 UI worklet/共享值，避免每帧 React 重渲染与 PictureRecorder；静态字体/版式预构建。现有导出已具备同一帧图、逐帧背压、取消和磁盘空间预检；进一步可改为零拷贝 pixel buffer、支持任务恢复/自动历史文件清理和 Android 编码。仪表监控实际 PTS 差、掉帧、资源回退率和低端机内存峰值。增加真机拖动/音频中断/前后台/导出帧一致性测试。

## d. 最难的问题与定位

真机启动又发现一个 **JS 日志不可见的 dyld 闪退**：用 `devicectl ... process launch --console` 抓到 `@rpath/React.framework/React` 缺失，再定向取本应用 `.ips` 报告确认 `namespace: DYLD / Library missing`；模拟器复现相同错误。检查 app 的 Frameworks 和 Podfile.lock，React Native Core 是源码构建，但 ExpoFileSystem 等预编译模块引用动态 React。曾关闭 Expo 预编译模块作为回退，但遭遇 ExpoModulesCore 源码的 Swift 并发编译错误；Hermes 源码构建还因磁盘耗尽失败。空间/网络恢复后重新解析 Pods，确认匹配的 `React-Core-prebuilt` 与 `hermes-engine/Pre-built`，最终恢复 `ios.usePrecompiledModules:true`，统一 SDK 默认预编译链路。不将原生装载失败误判为 JS 异常，不靠复制 dylib 或关闭并发检查掩盖问题。

最难的兼容性问题是**旧 Skia 视频取帧路线在已安装 3.4.4 中不存在**。不是靠旧文档猜 API：查本地 exports/`ImageFactory`，确认原生 `MakeImageFromNativeBuffer` 已改为 Web-only，类型检查也抓到 `Typeface.MakeDefault` 不存在；改用系统字体匹配和 Expo 57 原视频帧引用转换路线。检查原生源码还发现 `replaceAsync` 可能在主队列应用 AVPlayer item 之前 resolve，直接取帧可能得到空数组：改为等待 `statusChange=readyToPlay`、检查缺帧、超时显式回退。随后检查 iOS thumbnail generator 确认零 seek 容差，按请求时间排序，整段准备好才发布缓存，避免拖动时看到不完整帧缓存的错误末帧。时间边界也单测 7.0/7.2 秒转场和 48 秒末帧，避免区间右开导致片尾黑屏。实机性能和同步仍需设备验收，不把单测当作运行录屏。
