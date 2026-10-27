import { Panel } from '@forest/ui';
import Link from 'next/link';

export default function OrderNotFound() {
  return (
    <Panel className="flex flex-col gap-2 p-8">
      <h1 className="text-xl font-semibold">Buyurtma topilmadi</h1>
      <Link href="/orders" prefetch={false} className="text-sm underline">
        Buyurtmalar ro&apos;yxatiga qaytish
      </Link>
    </Panel>
  );
}
