import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';

describe('Input', () => {
  it('renders with label and required indicator', () => {
    render(
      <Input label="Email" name="email" value="" onChange={() => {}} required />
    );
    expect(screen.getByText('Email', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('displays error message when error prop is provided', () => {
    render(
      <Input label="Email" name="email" value="" onChange={() => {}} error="Format email tidak valid" />
    );
    expect(screen.getByText('Format email tidak valid')).toBeInTheDocument();
  });

  it('displays helper text when no error', () => {
    render(
      <Input label="Password" name="password" value="" onChange={() => {}} helperText="Minimal 8 karakter" />
    );
    expect(screen.getByText('Minimal 8 karakter')).toBeInTheDocument();
  });

  it('does not display helper text when error is present', () => {
    const { container } = render(
      <Input
        label="Password"
        name="password"
        value=""
        onChange={() => {}}
        helperText="Minimal 8 karakter"
        error="Password harus diisi"
      />
    );
    // Error should be shown
    expect(screen.getByText('Password harus diisi')).toBeInTheDocument();
    // Helper text should NOT be shown when error is present
    const helperTexts = container.querySelectorAll('.text-text-secondary');
    const helperParagraphs = Array.from(helperTexts).filter(
      (el) => el.tagName === 'P' && el.textContent === 'Minimal 8 karakter'
    );
    expect(helperParagraphs).toHaveLength(0);
  });

  it('calls onChange with the new value', () => {
    const handleChange = vi.fn();
    const { container } = render(<Input label="Name" name="name" value="" onChange={handleChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'John' } });
    expect(handleChange).toHaveBeenCalledWith('John');
  });

  it('calls onBlur when input loses focus', () => {
    const handleBlur = vi.fn();
    const { container } = render(<Input label="Name" name="name" value="test" onChange={() => {}} onBlur={handleBlur} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.blur(input);
    expect(handleBlur).toHaveBeenCalled();
  });

  it('toggles password visibility', () => {
    const { container } = render(
      <Input label="Password" name="password" type="password" value="secret" onChange={() => {}} />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('password');

    const toggleBtn = screen.getByText('Tampilkan');
    fireEvent.click(toggleBtn);
    expect(input.type).toBe('text');
    expect(screen.getByText('Sembunyikan')).toBeInTheDocument();
  });
});
