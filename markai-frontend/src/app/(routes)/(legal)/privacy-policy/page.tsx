"use client";
import LegalDocument from '@/components/legal/LegalDocument';
import { privacyPolicyData } from '@/data/legal';

const PrivacyPolicyPage = () => {
  return <LegalDocument document={privacyPolicyData} />;
}

export default PrivacyPolicyPage;