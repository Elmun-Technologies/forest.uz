import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Button, IconButton } from './button';
import { formatLocalDigits, PhoneInput, toLocalDigits } from './phone-input';
import { Price } from './price';
import { Field, Input } from './field';

describe('ui components', () => {
  it('Button defaults to type=button and supports loading', () => {
    render(<Button loading>Saqlash</Button>);
    const btn = screen.getByRole('button', { name: 'Saqlash' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn).toHaveProperty('disabled', true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('IconButton requires an accessible name', () => {
    render(<IconButton label="Savat">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Savat' })).toBeTruthy();
  });

  it('phone mask formats and strips +998', () => {
    expect(formatLocalDigits('901234567')).toBe('90 123 45 67');
    expect(toLocalDigits('+998 90 123-45-67')).toBe('901234567');
    expect(toLocalDigits('9012345678999')).toBe('901234567');
    function Harness() {
      const [v, setV] = useState('');
      return <PhoneInput aria-label="Telefon" value={v} onValueChange={setV} />;
    }
    render(<Harness />);
    const input = screen.getByLabelText('Telefon') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '+998901234567' } });
    expect(input.value).toBe('90 123 45 67');
  });

  it('Price renders so’m with non-breaking spaces and compare-at', () => {
    const { container } = render(<Price soum={549000} compareAtSoum={607000} locale="uz" from />);
    expect(container.textContent).toBe("dan\u00A0549\u00A0000\u00A0so'm607\u00A0000");
  });

  it('Field links errors to the control', () => {
    render(
      <Field label="Ism" error="Ismni kiriting">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Ism');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').id).toBe(input.getAttribute('aria-describedby'));
  });
});
