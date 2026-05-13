import { useEffect, useRef, useState } from 'react';
import { parseDecimalInput } from '../lib/format';

interface Props {
  /** The current numeric value owned by the parent. */
  value: number | null | undefined;
  /** Called whenever the user's typing parses to a finite number, or to
   *  null when the field is cleared. NOT called for in-progress states
   *  like "0," — the parent's value stays at the last valid parse. */
  onChange: (n: number | null) => void;
  placeholder?: string;
  className?: string;
  /** Allow the empty state to round-trip to null instead of 0. Default true. */
  allowEmpty?: boolean;
}

/**
 * Decimal input that accepts both `.` and `,` as the separator (for users on
 * iPhones in locales like Italian/German/French where comma is the decimal
 * key). Maintains its own *string* display state so partial input like "0,"
 * isn't stomped by the parent's numeric `value` round-tripping through
 * controlled-input rerenders.
 *
 * Why a separate component:
 *   - The naive pattern `<input type="text" value={String(num)} onChange={n=>setNum(parse(v))}>`
 *     fails for comma decimals: typing "0," sets state to 0, the rerender
 *     shows "0", and the comma never makes it back onto the screen. The next
 *     digit lands as "03" instead of "0,3", and the user sees a value of 3
 *     instead of 0.3.
 *   - Forms in AddEntry don't have this issue because their state is already
 *     all strings — but Settings and Vehicles store the model directly, and
 *     converting their entire form state to strings just for one input is
 *     overkill. A component is the right unit of encapsulation here.
 */
export function DecimalInput({
  value,
  onChange,
  placeholder,
  className,
  allowEmpty = true,
}: Props) {
  // Display state — what the user has typed. Independent from the parent's
  // numeric `value` so intermediate states like "0," survive renders.
  const [text, setText] = useState<string>(() =>
    value == null ? '' : String(value),
  );

  // When the parent's value changes *from outside* (e.g. loaded from DB,
  // reset on form open), resync the displayed text. But ignore round-trips
  // we just caused — otherwise typing "0,3" would round-trip 0.3 back here,
  // setText("0.3"), and the user's comma would still vanish.
  const lastEmittedRef = useRef<number | null | undefined>(value);
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setText(value == null ? '' : String(value));
      lastEmittedRef.current = value;
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={className}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === '') {
          lastEmittedRef.current = allowEmpty ? null : 0;
          onChange(allowEmpty ? null : 0);
          return;
        }
        const n = parseDecimalInput(raw);
        if (Number.isFinite(n)) {
          lastEmittedRef.current = n;
          onChange(n);
        }
        // If unparseable (e.g. "0,," or "abc"), leave the parent value alone
        // and keep the displayed text — user might still be mid-typing.
      }}
      onBlur={() => {
        // On blur, normalize the displayed text to match whatever the parent
        // ended up with. This cleans up dangling separators like "0," → "0".
        const v = lastEmittedRef.current;
        setText(v == null ? '' : String(v));
      }}
    />
  );
}
