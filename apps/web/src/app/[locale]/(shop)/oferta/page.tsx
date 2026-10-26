import { legalRoute } from '@/components/legal/legal-page';

const route = legalRoute('oferta');
export const generateMetadata = route.generateMetadata;
export default route.LegalPage;
