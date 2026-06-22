import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "../../styles/ui.css";

// Horizontal travel (px) a touch must cover before it's treated as a deliberate
// edit. Below this, a touch is a tap/scroll-start and must not change the value.
const TAP_THRESHOLD = 4;

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
  const inputRef = useRef<HTMLInputElement>(null);
  // Per-interaction touch state. `armed` gates whether a value change may commit:
  // false until a touch drags past TAP_THRESHOLD. Defaults armed=true so mouse,
  // pen and keyboard edits commit immediately (only touch must earn it).
  const touch = useRef({ active: false, armed: true, startX: 0 });

  return (
    <label className="field">
      <span className="field-head">
        <span className="label">{label}</span>
        <span className="field-val">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input
        ref={inputRef}
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") {
            touch.current = { active: true, armed: false, startX: e.clientX };
          } else {
            touch.current.active = false; // mouse/pen: edit immediately (click-on-track ok)
          }
        }}
        onPointerMove={(e) => {
          const t = touch.current;
          if (t.active && !t.armed && Math.abs(e.clientX - t.startX) > TAP_THRESHOLD) {
            t.armed = true; // a real horizontal drag: start editing from here
            if (inputRef.current) onChange(parseFloat(inputRef.current.value));
          }
        }}
        onPointerUp={() => {
          touch.current.active = false;
        }}
        onPointerCancel={() => {
          touch.current.active = false;
        }}
        onChange={(e) => {
          const t = touch.current;
          if (t.active && !t.armed) {
            // Tap or pre-threshold touch: ignore, and resync the thumb to the
            // controlled value so it doesn't visually drift (no jump-revert flicker).
            e.currentTarget.value = String(value);
            return;
          }
          onChange(parseFloat(e.target.value));
        }}
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
