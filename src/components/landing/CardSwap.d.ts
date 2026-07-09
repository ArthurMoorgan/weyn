import type { ComponentType, ReactNode, HTMLAttributes, RefAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement>, RefAttributes<HTMLDivElement> {
  customClass?: string;
}
export const Card: ComponentType<CardProps>;

export interface CardSwapProps {
  width?: number | string;
  height?: number | string;
  cardDistance?: number;
  verticalDistance?: number;
  delay?: number;
  pauseOnHover?: boolean;
  onCardClick?: (idx: number) => void;
  skewAmount?: number;
  easing?: "linear" | "elastic";
  children?: ReactNode;
}

declare const CardSwap: ComponentType<CardSwapProps>;
export default CardSwap;
