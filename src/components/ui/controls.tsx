import type { ButtonHTMLAttributes, ReactNode } from "react";
import "../../styles/ui.css";

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="field">
      <span className="field-head">
        <span className="label">{label}</span>
        <span className="field-val">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      {label && <span className="label">{label}</span>}
      <div className="segmented" role="group">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            data-active={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type BtnVariant = "primary" | "ghost" | "accent";
export function Button({
  variant = "ghost",
  children,
  ...rest
}: { variant?: BtnVariant; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn-${variant}`} {...rest}>
      {children}
    </button>
  );
}
