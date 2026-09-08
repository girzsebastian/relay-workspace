export default function ResizeHandle({
  axis,
  value,
  onChange,
  min,
  max,
  reverse = false,
  scale = 1,
  label,
}: {
  axis: "x" | "y";
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  reverse?: boolean;
  scale?: number;
  label: string;
}) {
  const clamp = (n: number) => Math.round(Math.min(max, Math.max(min, n)));
  return (
    <div
      className={`resize-handle resize-${axis}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onKeyDown={(event) => {
        const delta =
          event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 12
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? -12
              : 0;
        if (delta) {
          event.preventDefault();
          onChange(clamp(value + delta * (reverse ? -1 : 1) * scale));
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        element.setPointerCapture(event.pointerId);
        const initial = axis === "x" ? event.clientX : event.clientY;
        const move = (e: PointerEvent) =>
          onChange(
            clamp(
              value +
                ((axis === "x" ? e.clientX : e.clientY) - initial) *
                  (reverse ? -1 : 1) *
                  scale,
            ),
          );
        const end = () => {
          element.removeEventListener("pointermove", move);
          element.removeEventListener("pointerup", end);
          element.removeEventListener("pointercancel", end);
        };
        element.addEventListener("pointermove", move);
        element.addEventListener("pointerup", end);
        element.addEventListener("pointercancel", end);
      }}
    />
  );
}
