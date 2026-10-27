import { messagingSettingsProblems } from './settings-guard';

const night = { quietStart: '21:00', quietEnd: '09:00', marketingPerDay: 1 };

describe('messaging settings bounds', () => {
  it('accepts the defaults for everyone', () => {
    expect(messagingSettingsProblems(night, false)).toEqual([]);
    expect(messagingSettingsProblems(night, true)).toEqual([]);
  });

  it('quiet hours can never be switched off or shorter than 8 h', () => {
    for (const owner of [false, true]) {
      expect(messagingSettingsProblems({ ...night, quietStart: '09:00' }, owner)).toContainEqual({
        field: 'quietStart',
        rule: 'quiet_too_short',
      });
      expect(
        messagingSettingsProblems({ ...night, quietStart: '23:00', quietEnd: '06:00' }, owner),
      ).toContainEqual({ field: 'quietStart', rule: 'quiet_too_short' });
    }
  });

  it('non-owners may only widen the night window and keep the cap ≤ 2', () => {
    expect(messagingSettingsProblems({ ...night, quietStart: '20:00' }, false)).toEqual([]);
    expect(
      messagingSettingsProblems({ ...night, quietStart: '22:00', quietEnd: '10:00' }, false),
    ).toEqual([{ field: 'quietStart', rule: 'quiet_must_cover_night' }]);
    expect(messagingSettingsProblems({ ...night, marketingPerDay: 2 }, false)).toEqual([]);
    expect(messagingSettingsProblems({ ...night, marketingPerDay: 3 }, false)).toEqual([
      { field: 'marketingPerDay', rule: 'cap_too_high' },
    ]);
  });

  it('owners may move an 8 h+ window and raise the cap up to 5', () => {
    expect(
      messagingSettingsProblems(
        { quietStart: '22:00', quietEnd: '08:00', marketingPerDay: 5 },
        true,
      ),
    ).toEqual([]);
  });
});
