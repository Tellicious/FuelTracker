import { useEffect, useRef, useState } from 'react';
import { parseDecimalInput } from '../lib/format';

interface Props {

  value: number | null | undefined;

  onChange: (n: number | null) => void;
  placeholder?: string;
  className?: string;

  allowEmpty?: boolean;
}

export function DecimalInput({
  value,
  onChange,
  placeholder,
  className,
  allowEmpty = true,
}: Props) {


  const [text, setText] = useState<string>(() =>
    value == null ? '' : String(value),
  );





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


      }}
      onBlur={() => {


        const v = lastEmittedRef.current;
        setText(v == null ? '' : String(v));
      }}
    />
  );
}
