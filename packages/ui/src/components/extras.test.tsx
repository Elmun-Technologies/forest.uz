import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { BeforeAfter } from './before-after';
import { Rating } from './rating';
import { Stepper } from './stepper';

describe('ui extras', () => {
  it('Rating exposes its label and clamps the fill', () => {
    const { container } = render(<Rating value={7} label="5 dan 4,8" />);
    expect(screen.getByRole('img', { name: '5 dan 4,8' })).toBeTruthy();
    const fill = container.querySelector('[style]') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('Stepper respects min/max and announces value', () => {
    function Harness() {
      const [v, setV] = useState(1);
      return (
        <Stepper
          value={v}
          onChange={setV}
          max={2}
          labels={{ decrease: 'Kamaytirish', increase: "Ko'paytirish", value: 'Soni' }}
        />
      );
    }
    render(<Harness />);
    const dec = screen.getByRole('button', { name: 'Kamaytirish' });
    const inc = screen.getByRole('button', { name: "Ko'paytirish" });
    expect(dec).toHaveProperty('disabled', true);
    fireEvent.click(inc);
    expect(screen.getByLabelText('Soni').textContent).toBe('2');
    expect(inc).toHaveProperty('disabled', true);
  });

  it('BeforeAfter is a labelled range that clips the before layer', () => {
    const { container } = render(
      <BeforeAfter label="Oldin va keyin" before={<i>b</i>} after={<i>a</i>} initial={40} />,
    );
    const range = screen.getByLabelText('Oldin va keyin') as HTMLInputElement;
    expect(range.type).toBe('range');
    fireEvent.change(range, { target: { value: '70' } });
    const clip = container.querySelector('[style*="clip-path"]') as HTMLElement;
    expect(clip.style.clipPath).toBe('inset(0 30% 0 0)');
  });
});
