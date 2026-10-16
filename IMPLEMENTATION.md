# 实现原理

## 项目概览

这是一个基于 Expo 和 React Native 的本地回忆短片演示应用。它把一组事件、图片、音频和视频素材组织成一段 48 秒、包含 12 个片段的故事。用户可以播放和暂停、拖动时间轴、跳转章节、分享当前画面的 PNG，并在 iOS 上导出完整 MP4。

当前项目不连接业务后端。短片内容由本地 manifest 和打包资源提供；画面由 Skia 绘制，不包含 AI 图片生成或图像改写。

## 模块关系

```text
assets/candidate-pack/manifest.json
              │
              ├── 描述音轨、片段、事件数据、素材 URI 和转场
              ▼
       pack.ts + media.ts ── 加载素材、准备视频帧、记录失败并提供回退
              │
              ▼
 timeline.ts ── 将任意播放时间解析为片段、局部时间和转场图层
              │
              ▼
 render.ts ── drawFrame(canvas, time, media)：按时间绘制完整画面
              │
       ┌──────┴─────────┐
       ▼                ▼
   实时预览          离屏导出
 音轨作为主时钟   PNG 或固定采样的 MP4 帧
                        │
                        ▼
                 iOS AVFoundation 编码
```

## 1. 内容与素材配置

[`assets/candidate-pack/manifest.json`](./assets/candidate-pack/manifest.json) 是短片内容的声明式描述。它包含：

- 音轨 URI 和总时长。
- 每个片段的 ID、类型、开始时间、持续时间和转场。
- 各类事件对应的数据，例如任务名称、奖励、照片列表、人物头像和统计值。
- 图片或视频的 `asset://` / HTTPS URI。

[`src/memories/pack.ts`](./src/memories/pack.ts) 导入 manifest，并将本地图片、音频和视频资源映射到 Metro 可识别的静态模块。应用初始化时调用 `validateTimeline`，在播放前检查时间轴时长、片段范围、ID 唯一性和支持的转场类型。

这样，事件内容和绘制代码相对分离：增加或调整故事数据时，通常可以修改 manifest；如果增加了新的片段类型，则需要在渲染器中实现对应的绘制分支。

## 2. 时间轴计算

[`src/memories/timeline.ts`](./src/memories/timeline.ts) 只处理时间和数学逻辑，不依赖界面状态。

给定播放时间 `t`，`evaluateTimeline` 会：

1. 限制时间范围，确保结束时间仍然显示最后一帧。
2. 找出当前活动片段，并计算片段内的 `localTime`。
3. 如果当前处在转场窗口内，同时返回离场和进入的图层。
4. 根据淡入或左右滑动类型，计算每层透明度或水平偏移。

转场、动画和照片切换都由当前时间直接计算，而不是依赖上一次画面或持续运行的动画状态。因此拖动到任意位置后，可以独立重建对应画面。照片簇的图片索引和视频缓存帧索引也由纯函数计算，并限制在有效范围内。

## 3. 素材准备与错误回退

[`src/memories/media.ts`](./src/memories/media.ts) 负责将本地资源解码为 Skia 可绘制的图像，并保存到 `MediaStore`：

- 图片通过 Expo Asset 下载到本地后，由 Skia 解码。
- 本地视频使用 Expo Video 准备播放器，并按 12 fps 分批生成缩略帧；完成后释放临时缩略图和播放器资源。
- 远程视频 URI 会进行可达性检查。此演示不支持远程视频解码，因此远程片段采用占位图。
- 每个素材的失败原因放入 `failures`，其他素材和主时间轴仍可工作。

渲染器在素材缺失或视频失败时使用片段指定的占位照片；若占位素材也不存在，则绘制通用的“素材不可用”画面。应用卸载时会在异步解码任务结束后释放 Skia 图像句柄。

## 4. 统一画面渲染

[`src/memories/render.ts`](./src/memories/render.ts) 定义固定的逻辑画布 `360×540`，并导出 `drawFrame(canvas, time, media)`。它先根据 manifest 和当前时间获取时间轴图层，再绘制背景、章节内容、动画和图层转场。

不同片段类型在同一个渲染函数中分别处理，例如：

- 标题卡、片尾卡和文本信息。
- 任务、升级、奖励和统计数据。
- 多照片交叉淡入、轻微缩放等运镜。
- 从本地视频帧缓存中选帧，或绘制占位图片。

所有动画效果都使用 `localTime` 计算。相同的时间、manifest 和素材状态会得到相同的画面，因此预览、PNG 和 MP4 都可以共用渲染逻辑。

## 5. 播放时钟、拖动和章节跳转

[`src/memories/useMemories.ts`](./src/memories/useMemories.ts) 封装音频、媒体准备和播放状态。背景音乐由 Expo Audio 播放；应用读取原生播放器的 `currentTime` 作为主时钟，再将时间传给画面渲染。它不是通过累加动画帧时间来估算播放位置，因此缓冲或帧率变化时，画面仍以音轨位置为准。

拖动时间轴时，逻辑分为两段：

1. 拖动期间暂停音频，并用拖动位置更新画面，实现即时预览。
2. 手势结束后，对目标位置执行原生音频 seek；seek 确认后，如果拖动前处于播放状态则恢复播放，否则保持暂停。

seek 操作使用队列和 generation 标记，避免连续拖动时较早的异步 seek 覆盖较新的目标。章节按钮调用同一 seek 流程，定位到对应片段的开始位置附近。应用进入后台时会暂停播放。

应用界面位于 [`src/app/index.tsx`](./src/app/index.tsx)，包括短片画布、进度条、播放控制、章节列表、素材状态和导出操作；根路由使用 Expo Router，布局在 [`src/app/_layout.tsx`](./src/app/_layout.tsx)。

## 6. PNG 分享

[`src/memories/exportFrame.ts`](./src/memories/exportFrame.ts) 会创建离屏 Skia Surface，将逻辑画布放大到 720×1080，调用 `drawFrame` 绘制指定时间的内容，再编码为 PNG。图片保存到应用 Documents 目录，之后通过 Expo Sharing 打开系统分享面板。

由于 PNG 使用和预览相同的 `drawFrame`，分享内容对应用户当前时间点的短片画面，而不是对屏幕截图进行裁剪。

## 7. MP4 导出（iOS）

MP4 导出由 JavaScript 编排、iOS 原生模块编码，入口为 [`src/memories/exportVideo.ts`](./src/memories/exportVideo.ts)：

1. 暂停预览，检查平台、原生编码模块和背景音乐本地资源。
2. 创建 720×1080 的离屏 Skia Surface。
3. 按 `t = n / 30` 生成 1,440 个画面，覆盖 48 秒的时间范围。
4. 将每个画面读取为 BGRA 像素，并写入临时帧文件。
5. 调用原生模块追加当前帧；如果编码器暂时无法接收数据，则等待后重试当前帧，不跳帧也不重复渲染。
6. 编码完成后，原生模块将背景音乐转换成 AAC，与视频合并，并保存 MP4。
7. 打开系统分享面板；成功或取消后清理临时帧和未完成输出。

[`modules/memories-video/ios/MemoriesVideoModule.swift`](./modules/memories-video/ios/MemoriesVideoModule.swift) 暴露 start、append、finish 和 cancel 接口；[`modules/memories-video/ios/VideoEncoder.swift`](./modules/memories-video/ios/VideoEncoder.swift) 使用 AVFoundation 执行 H.264 编码、AAC 转换和音视频合并。编码器串行处理帧，并在帧提交时提供背压，避免把整部影片的像素帧一次性保存在内存中。

视频导出支持进度和取消，并在应用进入后台或离开页面时取消正在进行的导出。导出前会检查磁盘空间。该原生编码入口目前仅针对 iOS；Android 和 Web 不提供 MP4 编码，但 PNG 分享仍可使用。导出输出为 30 fps，但本地视频源只缓存了 12 fps，因此视频片段不会因此获得高于源缓存的运动细节。

## 8. 测试

- [`tests/timeline.test.mjs`](./tests/timeline.test.mjs) 检查时间轴有效性、任意时间点求值、转场方向、坏素材回退、照片/视频帧索引，以及整段 30 fps 采样没有空白画面。
- [`tests/exportSequence.test.mjs`](./tests/exportSequence.test.mjs) 检查 MP4 帧数和时间点、编码器背压重试、取消行为，以及错误是否正确向上抛出。
- [`tests/nativeExport.swift`](./tests/nativeExport.swift) 可配合 AVFoundation 编码器做原生编码集成测试。

常用验证命令：

```sh
npm run typecheck
npm run lint
npm test
```
