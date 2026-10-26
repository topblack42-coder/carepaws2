import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Accessible name; also used as the tooltip unless `title` is passed. */
  label: string;
  tone?: "neutral" | "success" | "danger";
  size?: "sm" | "md";
  children: ReactNode;
}

const TONE_CLASSES: Record<NonNullable<IconButtonProps["tone"]>, string> = {
  neutral: "text-gray-500 hover:bg-gray-100 focus-visible:outline-gray-400",
  success: "text-status-success hover:bg-status-successBg focus-visible:outline-status-success",
  danger: "text-status-danger hover:bg-status-dangerBg focus-visible:outline-status-danger",
};

const SIZE_CLASSES: Record<NonNullable<IconButtonProps["size"]>, string> = {
  sm: "p-1.5",
  md: "p-2",
};

export default function IconButton({
  label,
  tone = "neutral",
  size = "sm",
  type = "button",
  title,
  className = "",
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={`inline-flex items-center justify-center rounded-lg transition-colors
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
