'use client';

import React, { useState } from 'react';

export interface InputProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel';
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  helperText?: string;
  prefix?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
}

export function Input({
  type = 'text',
  label,
  placeholder,
  value,
  onChange,
  onBlur,
  error,
  helperText,
  prefix,
  disabled = false,
  required = false,
  id,
  name,
  className = '',
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const inputType = type === 'password' && showPassword ? 'text' : type;

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <label
          htmlFor={id || name}
          className="block text-sm font-medium text-text mb-1.5"
        >
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">
            {prefix}
          </span>
        )}
        <input
          id={id || name}
          name={name}
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={[
            'w-full px-3 py-2.5 text-sm rounded-md border transition-colors duration-150',
            'placeholder:text-text-secondary/60',
            'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-bg-secondary',
            error
              ? 'border-danger focus:ring-danger/20 focus:border-danger'
              : 'border-border hover:border-text-secondary/50',
            prefix ? 'pl-9' : '',
          ].join(' ')}
        />
        {type === 'password' && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text text-sm"
            tabIndex={-1}
          >
            {showPassword ? 'Sembunyikan' : 'Tampilkan'}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-danger">{error}</p>
      )}
      {!error && helperText && (
        <p className="mt-1 text-xs text-text-secondary">{helperText}</p>
      )}
    </div>
  );
}

export default Input;
