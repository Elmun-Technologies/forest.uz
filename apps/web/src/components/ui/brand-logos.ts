/** Partner logos (payment & delivery context only, design/README). Static imports → sized, hashed. */
import bts from '../../../public/logos/bts.png';
import btsDark from '../../../public/logos/bts-on-dark.png';
import click from '../../../public/logos/click.png';
import clickDark from '../../../public/logos/click-on-dark.png';
import payme from '../../../public/logos/payme.png';
import paymeDark from '../../../public/logos/payme-on-dark.png';
import yandex from '../../../public/logos/yandex-delivery.png';
import yandexDark from '../../../public/logos/yandex-delivery-on-dark.png';

export const logos = {
  light: { PAYME: payme, CLICK: click, YANDEX: yandex, BTS: bts },
  dark: { PAYME: paymeDark, CLICK: clickDark, YANDEX: yandexDark, BTS: btsDark },
} as const;

export const logoAlt = {
  PAYME: 'Payme',
  CLICK: 'Click',
  YANDEX: 'Yandex Dostavka',
  BTS: 'BTS',
} as const;
