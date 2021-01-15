export interface MotionEvent {
  status: "ON" | "OFF";
  camera_id: string;
  camera_name: string;
  timestamp: string;
}

export interface CameraTimestamps {
  [key: string]: number;
}

export interface DownloadQueue {
  [key: string]: NodeJS.Timeout;
}
