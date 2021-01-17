export interface MotionEvent {
  // camera id
  camera: string;
  // event start timestamp
  start: number;
  // event end timestamp
  end: number;
}

export interface CameraTimestamps {
  [key: string]: number;
}

export interface DownloadQueue {
  [key: string]: NodeJS.Timeout;
}
