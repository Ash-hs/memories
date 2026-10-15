import rawManifest from "../../assets/candidate-pack/manifest.json";
import { validateTimeline } from "./timeline";

export const manifest = rawManifest;
export type Segment = (typeof manifest.timeline)[number];
validateTimeline(manifest.timeline, manifest.audio.duration);

export const imageModules: Record<string, number> = {
  "asset://images/task_icon.png": require("../../assets/candidate-pack/assets/images/task_icon.png"),
  "asset://images/toggee_happy.png": require("../../assets/candidate-pack/assets/images/toggee_happy.png"),
  "asset://images/icon_btc.png": require("../../assets/candidate-pack/assets/images/icon_btc.png"),
  "asset://images/avatar_1.png": require("../../assets/candidate-pack/assets/images/avatar_1.png"),
  "asset://images/avatar_2.png": require("../../assets/candidate-pack/assets/images/avatar_2.png"),
  "asset://images/avatar_3.png": require("../../assets/candidate-pack/assets/images/avatar_3.png"),
  "asset://images/photo_01.png": require("../../assets/candidate-pack/assets/images/photo_01.png"),
  "asset://images/photo_02.png": require("../../assets/candidate-pack/assets/images/photo_02.png"),
  "asset://images/photo_03.png": require("../../assets/candidate-pack/assets/images/photo_03.png"),
  "asset://images/reward.png": require("../../assets/candidate-pack/assets/images/reward.png"),
};

export const audioModule = require("../../assets/candidate-pack/assets/audio/bgm.mp3");
export const videoModule = require("../../assets/candidate-pack/assets/video/clip_ok.mp4");

export const segmentLabels: Record<string, string> = {
  title_card: "八月序章",
  action_task_complete: "完成任务",
  action_toggee_upgrade: "Pip 升级",
  action_btc_purchase: "储蓄里程碑",
  action_friend_connect: "新朋友",
  action_guardian_reward_star: "家人的鼓励",
  action_guardian_deduct_star: "温柔的提醒",
  action_photo_cluster: "后院探险",
  video_clip: "视频瞬间",
  action_toggee_interaction_summary: "陪伴统计",
  outro_card: "下次再见",
};
