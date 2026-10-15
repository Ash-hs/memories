import { requireOptionalNativeModule } from "expo";

interface MemoriesVideoModule {
  start(output: string, audio: string, width: number, height: number, fps: number, count: number): Promise<string>;
  append(id: string, frame: string, index: number): Promise<boolean>;
  finish(id: string): Promise<string>;
  cancel(id: string): Promise<void>;
}

export default requireOptionalNativeModule<MemoriesVideoModule>("MemoriesVideo");
