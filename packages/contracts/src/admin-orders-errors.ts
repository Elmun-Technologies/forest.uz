/** Admin orders (A6/A7) error codes, merged into `ADMIN_ERROR_MESSAGES`. */
export const ADMIN_ORDERS_ERROR_MESSAGES = {
  ORDER_PAID_REFUND_FIRST: {
    http: 409,
    uz: "Buyurtma to'langan: bekor qilish uchun pulni to'liq qaytaring (qaytarish buyurtmani bekor qiladi).",
    ru: 'Заказ оплачен: чтобы отменить, верните деньги полностью (возврат отменит заказ).',
  },
  ADMIN_PII_FORBIDDEN: {
    http: 403,
    uz: "Mijoz ma'lumotlarini to'liq ko'rish uchun huquq yo'q.",
    ru: 'Нет права видеть полные данные клиента.',
  },
} as const satisfies Record<string, { http: number; uz: string; ru: string }>;
