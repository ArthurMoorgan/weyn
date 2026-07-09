import type { ComponentType, CSSProperties } from "react";

export interface FloatingLinesProps {
  linesGradient?: string[];
  enabledWaves?: Array<"top" | "middle" | "bottom">;
  lineCount?: number | number[];
  lineDistance?: number | number[];
  topWavePosition?: { x: number; y: number; rotate: number };
  middleWavePosition?: { x: number; y: number; rotate: number };
  bottomWavePosition?: { x: number; y: number; rotate: number };
  animationSpeed?: number;
  interactive?: boolean;
  bendRadius?: number;
  bendStrength?: number;
  mouseDamping?: number;
  parallax?: boolean;
  parallaxStrength?: number;
  mixBlendMode?: CSSProperties["mixBlendMode"];
}

declare const FloatingLines: ComponentType<FloatingLinesProps>;
export default FloatingLines;
