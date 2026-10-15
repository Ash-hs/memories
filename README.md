# Memories / Return

Expo 57 + React Native 的 48 秒回顾短片 demo，直接使用 `assets/candidate-pack/manifest.json` 和原资源，不连接业务后端。照片/视频不做生成式改图、换脸、风格迁移或 AI 增强；电影感仅来自轻排版、照片运镜和转场。

## 启动

```sh
npm install
npm run ios
# 已安装包含新增模块的开发客户端后：
npm start
```

新增了 SDK 匹配的 `expo-audio`、`expo-video`、`expo-image-manipulator`、`expo-file-system`、`expo-sharing`、`expo-asset`，**旧开发客户端需重新构建**。保留已有 `react-native-skia@3.4.4`，这是当前 Skia 项目提供的包名，未替换成另一版本。若 CocoaPods 提示 ASCII 编码错误，运行 `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npm run ios`。首版目标为 iOS，未声明 Android / Web 已验证。

MP4 新增本地 Expo module `modules/memories-video`，自动链接、不新增第三方编码库。**已安装的旧客户端也必须重新运行 `npm run ios` 构建安装**，仅刷新 Metro 不会加入编码模块；缺少模块会明确提示重新构建，PNG 分享不受影响。

### 启动直接闪退、Metro 没有报错

已在真机与模拟器复现 `dyld: Library not loaded: @rpath/React.framework/React`：React Native Core 缺少预编译框架、回退源码构建时，Expo 预编译模块仍依赖动态 `React.framework`，导致 JS 启动前退出。曾尝试关闭 Expo 预编译，但 ExpoModulesCore 源码在 Xcode 26.3 下报 Swift 并发检查错误 `sending 'emitter' risks causing data races`。**最终配置恢复 `ios.usePrecompiledModules: true`**：React Native Core / Hermes 已重新解析为匹配预编译包，与 Expo 模块统一使用 SDK 默认预编译链路。配置改动后不能只刷新 Metro，需重新生成并构建：

```sh
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo prebuild --platform ios --no-install
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device
```

不手改生成的 Pods、不往 app 手工拷贝框架、不降低 Swift 并发安全检查。安装 Pods 时须确认 React Native Core 没有回退源码构建，且生成的嵌入脚本包含 `React.framework`。

### Hermes 编译报 `No space left on device`

这表示 Mac 构建磁盘耗尽，并非 pack 路径问题：示例素材约 12 MB，项目 Xcode DerivedData 可能达到数 GB。先释放磁盘空间再构建，建议至少留 10 GB 余量；不要在空间不足时反复 prebuild 或全量编译。若 Maven 可用性检测曾失败，Pods 会回退 Hermes 源码编译；网络/空间恢复后重新解析：

```sh
cd ios
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod update hermes-engine --no-repo-update
cd ..
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device
```

已验证重新解析后 `ios/Podfile.lock` 为 `hermes-engine/Pre-built (250829098.0.17)`，React Native Core 同时使用 `React-Core-prebuilt (0.86.3)`，生成的框架嵌入脚本包含 `React.framework`。此操作没有升级 JS 依赖版本；不要通过移动素材、禁用 Hermes 或忽略编译错误绕过问题。

## 使用与验收

- 播放 / 暂停 / 重播；进度条可拖动到任意位置，暂停时也可查看运镜和转场。
- 拖动或点击时间轴时，播放与 MP4 导出按钮不因短暂的音轨对齐而变淡或切换为“对齐中”；播放状态保留拖动前的意图，松手后按原状态继续。对齐期间仍阻止重复操作，按钮与逐帧进度更新隔离。
- 章节按钮用于快速定位。**31–37 秒**是 manifest 的故意坏链：原照片占位，背景音乐继续；**37–42.5 秒**显示原本地视频的帧序列。
- 视频帧异步准备期间立即使用原照片占位，不影响其余片段播放。错误显示在状态区，日志保留具体原因。
- **分享帧**：暂停并将当前时间 `t` 离屏渲染成 720×1080 PNG，保存到应用 Documents 并打开系统分享面板。
- **导出完整 MP4（iOS）**：素材准备完成后点击按钮，暂停预览，以固定 `t=n/30` 离屏合成 1,440 帧，输出 **720×1080、30 fps、48 秒的 H.264 + AAC MP4**。背景音乐裁切至 48 秒，视频原声按 manifest 静音，不额外混入 SFX。坏链占位、转场、排版与 PNG/预览共用渲染器；原视频仍使用现有 12 fps 帧缓存，不声称源视频恢复到 30 fps。
- 导出显示帧进度及音乐合成状态，完成后保存到应用 Documents 并打开系统分享。可取消；离开前台/页面也会取消未完成导出、清理临时帧和未完成 MP4。请保持前台并至少预留 150 MB 空间。每次只传递一帧 BGRA，等待原生编码器背压，不缓存整片帧序列，也不使用屏幕录制或服务端渲染。
- Android / Web 不提供 MP4 编码入口，仍保留 PNG 分享；未对这两个平台声明已验证。

```sh
npm run typecheck
npm run lint
npm test
```

测试使用 Node 22.17+ 内建 TypeScript stripping / test runner，不增加测试库；Node 的 experimental / module-type 警告不影响结果。测试覆盖 12 段时间轴、任意 Seek、双向滑动/淡入转场、照片切换、视频帧索引、坏链后续段、结束帧，以及整片 30 fps 的 1,441 个时间采样点。

新增导出测试覆盖精确 1,440 帧/固定时间戳、背压重试、取消及编码错误传播。macOS 可直接编译与 iOS 共用的 AVFoundation 编码器做原生集成测试（合成色块用于检查格式和时间戳，不冒充实际 UI 导出）：

```sh
xcrun swiftc -swift-version 5 modules/memories-video/ios/VideoEncoder.swift tests/nativeExport.swift -o /tmp/memories-native-export-test
/tmp/memories-native-export-test assets/candidate-pack/assets/audio/bgm.mp3 /tmp/memories-native-export-test.mp4
ffprobe -v error -show_streams -show_format /tmp/memories-native-export-test.mp4
```

测试输出路径必须尚不存在；执行后可删除这两个指定测试文件。真机验收还应检查完整 MP4 的照片/转场、坏链占位、后续视频、音轨与 PNG 对照，以及中途取消后可重新导出。

### 已完成的验收（2026-10-15）

- 用户在 iPhone SE 真机上确认：编译启动成功、回顾页面正常播放。
- 用户手动确认：暂停拖动即时预览，松手后从目标位置继续、不跳回；坏链照片占位不断音，随后进入正常视频。
- 用户确认系统分享面板正常、保存 PNG 与当前画面一致。通过 `devicectl` 定向读取本应用 Documents，确认实际生成帧文件，并取回一张检查尺寸为 **720×1080**，画面为对应 16.580 秒的朋友章节。
- 最终 `typecheck`、`lint`、8 项时间轴测试与 `git diff --check` 通过。
- 用户随后确认 iOS App 内完整 MP4 导出成功；此前 macOS 原生色块编码及真实 BGM 合轨测试也已运行成功。尚未逐帧核对真机导出与预览的一致性，也未完成取消/重新导出的真机验收。仍未交付 30–60 秒运行录屏。端到端同步延迟、低端机帧率和内存峰值未做量化测量。

## 30–60 秒录屏脚本

1. 播放约 5 秒，展示照片/文字/转场与背景音乐。
2. 暂停，把进度条拖到 26–30 秒照片簇，再拖到 7.2 秒转场中间，展示画面由时间直接恢复。
3. 点“坏链演示”，恢复播放到 38 秒，展示占位无卡顿、随后进入正常原视频。
4. 点“分享帧”展示 PNG 分享；再点“导出完整 MP4”展示离线进度、取消/重新导出和最终视频分享（可剪辑等待过程，但注明离线导出耗时）。

录屏须使用实际 iOS 模拟器或设备完成，不能用测试报告替代运行录屏。

## 主要代码

- [时间轴纯函数](./src/memories/timeline.ts)：边界检查、段选择、转场、照片/视频帧定位。
- [统一 Skia 渲染器](./src/memories/render.ts)：`drawFrame(canvas, t, media)`，预览和离屏导出共享。
- [音频主时钟](./src/memories/useMemories.ts)：原生音频位置采样、Seek 序列化、生命周期。
- [资源准备与回退](./src/memories/media.ts)：独立素材错误、视频帧缓存、原始照片占位。
- [离屏导出](./src/memories/exportFrame.ts)：PNG 保存和系统分享。
- [MP4 导出](./src/memories/exportVideo.ts)：共享 Skia 离屏渲染、逐帧背压、取消和视频分享。
- [iOS 编码器](./modules/memories-video/ios/VideoEncoder.swift)：H.264 编码、AAC 音频转换、MP4 合轨及清理。
