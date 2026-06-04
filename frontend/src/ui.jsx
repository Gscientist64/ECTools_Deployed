import React from 'react';
import { ChevronDown } from 'lucide-react';

export const Button = ({ className = '', children, variant = 'primary', ...props }) => {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed';
  const variants = {
    primary:
      'bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-700 text-white hover:brightness-110 focus:ring-emerald-300',
    outline:
      'border border-neutral-300 text-neutral-900 bg-white hover:bg-neutral-50 focus:ring-neutral-300',
    ghost:
      'bg-transparent text-neutral-900 hover:bg-neutral-100 focus:ring-neutral-300',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

export const Input = (props) => (
  <input
    {...props}
    className={`w-full rounded-xl border border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400 px-4 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 ${props.className || ''}`}
  />
);

export const Select = ({ value, onChange, options, placeholder = 'Select' }) => (
  <div className="relative">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="appearance-none w-full rounded-xl border border-neutral-300 bg-white text-neutral-900 px-4 py-2 pr-10 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
  </div>
);

export const Chip = ({ children, color = 'neutral' }) => {
  const palette = {
    neutral: 'bg-neutral-200 text-neutral-800',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${palette[color]}`}>
      {children}
    </span>
  );
};
