import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        success: 'border-success-line bg-success-bg text-success',
        warning: 'border-warning-line bg-warning-bg text-warning',
        destructive: 'border-danger-line bg-danger-bg text-danger',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { badgeVariants }
