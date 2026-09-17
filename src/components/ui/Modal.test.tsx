import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Modal } from './Modal';

describe('Modal', () => {
  afterEach(() => {
    cleanup();
    // Clear any portaled elements from body
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <Modal isOpen={false} onClose={() => {}}>
        <p>Content</p>
      </Modal>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders modal content when isOpen is true', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <p>Modal Content</p>
      </Modal>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Test Title">
        <p>Content</p>
      </Modal>
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} showCloseButton={true}>
        <p>Content</p>
      </Modal>
    );
    fireEvent.click(screen.getByLabelText('Tutup modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render close button when showCloseButton is false', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} showCloseButton={false} title={undefined}>
        <p>Content</p>
      </Modal>
    );
    expect(screen.queryByLabelText('Tutup modal')).not.toBeInTheDocument();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay is clicked with closeOnOverlayClick=true', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} closeOnOverlayClick={true}>
        <p>Content</p>
      </Modal>
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when overlay is clicked with closeOnOverlayClick=false', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} closeOnOverlayClick={false}>
        <p>Content</p>
      </Modal>
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when content is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} closeOnOverlayClick={true}>
        <p>Content Inside</p>
      </Modal>
    );
    fireEvent.click(screen.getByText('Content Inside'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('applies correct size class for sm variant', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} size="sm">
        <p>Content</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const content = dialog.querySelector('[tabindex="-1"]');
    expect(content?.className).toContain('max-w-[400px]');
  });

  it('applies correct size class for md variant', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} size="md">
        <p>Content</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const content = dialog.querySelector('[tabindex="-1"]');
    expect(content?.className).toContain('max-w-[560px]');
  });

  it('applies correct size class for lg variant', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} size="lg">
        <p>Content</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const content = dialog.querySelector('[tabindex="-1"]');
    expect(content?.className).toContain('max-w-[720px]');
  });

  it('applies correct size class for fullscreen variant', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} size="fullscreen">
        <p>Content</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const content = dialog.querySelector('[tabindex="-1"]');
    expect(content?.className).toContain('max-w-full');
    expect(content?.className).toContain('w-full');
    expect(content?.className).toContain('h-full');
  });

  it('has proper accessibility attributes', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Accessible Modal">
        <p>Content</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
  });

  it('locks body scroll when open', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <p>Content</p>
      </Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    const { rerender } = render(
      <Modal isOpen={true} onClose={() => {}}>
        <p>Content</p>
      </Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal isOpen={false} onClose={() => {}}>
        <p>Content</p>
      </Modal>
    );
    expect(document.body.style.overflow).toBe('');
  });
});
