// 窗口状态类型定义

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export type WindowDisplayState = "normal" | "minimized" | "maximized";

export interface WindowState {
  id: string;
  skillId: string;
  title: string;
  icon: string;
  position: WindowPosition;
  size: WindowSize;
  minSize: WindowSize;
  state: WindowDisplayState;
  zIndex: number;
  isFocused: boolean;
  isAnimating: boolean;
  pendingMinimize?: boolean;
  skillState?: Record<string, unknown>;
  // 最大化前的快照，用于还原
  preMaximizeSnapshot?: { position: WindowPosition; size: WindowSize };
}
