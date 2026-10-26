import { legalRoute } from '@/components/legal/legal-page';

const route = legalRoute('yetkazish-tolov', { zones: true });
export const generateMetadata = route.generateMetadata;
export default route.LegalPage;
