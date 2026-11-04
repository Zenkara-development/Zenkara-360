/**
 * RobotFace — a lightweight CSS version of the assistant robot.
 *
 * Shown while the 3D scene is still loading, and permanently when the
 * browser cannot create a WebGL context. Same look (white head, dark visor,
 * glowing blinking eyes, blue cap), no three.js. Styles live in index.css
 * under "Assistant robot".
 */
import type { RobotMood } from './types';

export function RobotFace({ mood = 'idle', className = '' }: { mood?: RobotMood; className?: string }) {
  return (
    <div className={`robot-face robot-face--${mood} ${className}`} aria-hidden="true">
      <span className="robot-face__cap" />
      <span className="robot-face__head">
        <span className="robot-face__visor">
          <span className="robot-face__eye" />
          <span className="robot-face__eye" />
        </span>
      </span>
    </div>
  );
}

/** True when the browser can create a WebGL context. Cached after the first call. */
let webgl: boolean | null = null;
export function canUseWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement('canvas');
    webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    webgl = false;
  }
  return webgl;
}
