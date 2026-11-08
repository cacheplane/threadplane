// Host-authored button/textarea skin; the official ToolFallback logic is unchanged.
import { forwardRef, type ComponentProps } from 'react';
export const Button = forwardRef<
  HTMLButtonElement,
  ComponentProps<'button'> & { size?: string; variant?: string }
>(function Button({ size: _size, variant: _variant, ...props }, ref) {
  return <button ref={ref} {...props} />;
});
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<'textarea'>
>(function Textarea(props, ref) {
  return <textarea ref={ref} {...props} />;
});
