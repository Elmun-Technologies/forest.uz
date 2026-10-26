/** Regions of Uzbekistan and Tashkent city districts (checkout selectors, delivery zones). */
export const UZ_REGIONS = [
  { code: 'tashkent_city', uz: 'Toshkent shahri', ru: 'город Ташкент' },
  { code: 'tashkent_region', uz: 'Toshkent viloyati', ru: 'Ташкентская область' },
  { code: 'andijan', uz: 'Andijon', ru: 'Андижанская область' },
  { code: 'bukhara', uz: 'Buxoro', ru: 'Бухарская область' },
  { code: 'fergana', uz: "Farg'ona", ru: 'Ферганская область' },
  { code: 'jizzakh', uz: 'Jizzax', ru: 'Джизакская область' },
  { code: 'kashkadarya', uz: 'Qashqadaryo', ru: 'Кашкадарьинская область' },
  { code: 'khorezm', uz: 'Xorazm', ru: 'Хорезмская область' },
  { code: 'namangan', uz: 'Namangan', ru: 'Наманганская область' },
  { code: 'navoi', uz: 'Navoiy', ru: 'Навоийская область' },
  { code: 'samarkand', uz: 'Samarqand', ru: 'Самаркандская область' },
  { code: 'sirdarya', uz: 'Sirdaryo', ru: 'Сырдарьинская область' },
  { code: 'surkhandarya', uz: 'Surxondaryo', ru: 'Сурхандарьинская область' },
  { code: 'karakalpakstan', uz: "Qoraqalpog'iston Respublikasi", ru: 'Республика Каракалпакстан' },
] as const;

export type RegionCode = (typeof UZ_REGIONS)[number]['code'];

export const TASHKENT_DISTRICTS = [
  { code: 'bektemir', uz: 'Bektemir', ru: 'Бектемир' },
  { code: 'chilonzor', uz: 'Chilonzor', ru: 'Чиланзар' },
  { code: 'mirobod', uz: 'Mirobod', ru: 'Мирабад' },
  { code: 'mirzo_ulugbek', uz: "Mirzo Ulug'bek", ru: 'Мирзо-Улугбек' },
  { code: 'olmazor', uz: 'Olmazor', ru: 'Алмазар' },
  { code: 'sergeli', uz: 'Sergeli', ru: 'Сергели' },
  { code: 'shayxontohur', uz: 'Shayxontohur', ru: 'Шайхантахур' },
  { code: 'uchtepa', uz: 'Uchtepa', ru: 'Учтепа' },
  { code: 'yakkasaroy', uz: 'Yakkasaroy', ru: 'Яккасарай' },
  { code: 'yangihayot', uz: 'Yangihayot', ru: 'Янгихаёт' },
  { code: 'yashnobod', uz: 'Yashnobod', ru: 'Яшнабад' },
  { code: 'yunusobod', uz: 'Yunusobod', ru: 'Юнусабад' },
] as const;

export function isRegionCode(value: string): value is RegionCode {
  return UZ_REGIONS.some((r) => r.code === value);
}
