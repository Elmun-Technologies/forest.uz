import { Slot } from '@radix-ui/react-slot';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

const variants = {
  primary: 'bg-ink text-white hover:bg-dark-3',
  brand: 'bg-forest text-white hover:bg-forest-700',
  secondary: 'border border-ink bg-transparent text-ink hover:bg-ink hover:text-white',
  outline: 'border border-line bg-panel text-ink hover:border-ink',
  ghost: 'bg-transparent text-ink hover:bg-canvas',
  inverse: 'bg-white text-ink hover:bg-sage-50',
  danger: 'border border-critical-bg bg-critical-bg text-critical hover:border-critical',
} as const;

const sizes = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-[52px] px-7 text-[15px]',
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (e.g. a Next <Link>) with button styles. */
  asChild?: boolean;
  block?: boolean;
  loading?: boolean;
}

export const buttonClasses = (
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  block = false,
) =>
  cn(
    'inline-flex select-none items-center justify-center gap-2 rounded-pill font-semibold whitespace-nowrap',
    'transition-colors duration-200 ease-out disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    block && 'w-full',
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    asChild,
    block,
    loading,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonClasses(variant, size, block), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      type={asChild ? undefined : (type ?? 'button')}
      {...rest}
    >
      {children}
    </Comp>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  variant?: 'outline' | 'primary' | 'ghost' | 'inverse';
  size?: 'sm' | 'md' | 'lg';
}

const iconSizes = { sm: 'size-9', md: 'size-11', lg: 'size-12' } as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'outline', size = 'md', className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-pill transition-colors duration-200',
        variants[variant === 'outline' ? 'outline' : variant],
        iconSizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
