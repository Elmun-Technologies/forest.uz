import type { Carrier, OrderStatus, PaymentMethod, PaymentStatus } from '@forest/contracts/core';
import { Badge, cn } from '@forest/ui';
import Image from 'next/image';
import {
  CARRIER_LABEL,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
} from './copy';

export function OrderStatusBadge({ status, late }: { status: OrderStatus; late?: boolean }) {
  if (late) return <Badge tone="critical">Kechikmoqda</Badge>;
  return <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

const PAY_LOGO: Partial<Record<PaymentMethod, { src: string; w: number; h: number }>> = {
  PAYME: { src: '/logos/payme.png', w: 48, h: 14 },
  CLICK: { src: '/logos/click.png', w: 50, h: 13 },
};

/** Payme/Click logo or "NAQD" + the payment state (design A6 "To'lov" column). */
export function PaymentCell({
  method,
  status,
}: {
  method: PaymentMethod;
  status: PaymentStatus | null;
}) {
  const logo = PAY_LOGO[method];
  const settled = status === 'PAID';
  return (
    <span className="flex flex-col gap-1">
      {logo ? (
        <Image src={logo.src} alt={PAYMENT_METHOD_LABEL[method]} width={logo.w} height={logo.h} />
      ) : (
        <b className="text-[11px] font-bold tracking-[0.04em]">NAQD</b>
      )}
      {status ? (
        <span
          className={cn(
            'text-xs font-semibold',
            settled ? 'text-good' : status === 'PENDING' ? 'text-critical' : 'text-warn',
          )}
        >
          {PAYMENT_STATUS_LABEL[status]}
        </span>
      ) : null}
    </span>
  );
}

const CARRIER_LOGO: Partial<Record<Carrier, { src: string; w: number; h: number }>> = {
  YANDEX: { src: '/logos/yandex-delivery.png', w: 88, h: 11 },
  BTS: { src: '/logos/bts.png', w: 40, h: 20 },
};

export function CarrierLogo({ carrier, className }: { carrier: Carrier; className?: string }) {
  const logo = CARRIER_LOGO[carrier];
  if (!logo)
    return <b className={cn('text-xs font-semibold', className)}>{CARRIER_LABEL[carrier]}</b>;
  return (
    <Image
      src={logo.src}
      alt={CARRIER_LABEL[carrier]}
      width={logo.w}
      height={logo.h}
      className={className}
    />
  );
}
