/**
 * Edition branding — the ONLY web file that differs between the company and the open-source edition.
 * Each repo commits its own copy; never copy this file between repos.
 */
export interface BrandLink { label: string; href: string }
export const BRAND: { product: string; tagline: string; org: { name: string; href?: string }; links: BrandLink[] } = {
  product: 'InfraMatrix',
  tagline: 'Open-source Infrastructure Tracker by',
  org: { name: 'Muhammed Noufal', href: 'https://muhammednoufal.cybermavericx.com' },
  links: [
    { label: 'cybermavericx.com', href: 'https://cybermavericx.com' },
    { label: 'GitHub', href: 'https://github.com/cybermavericx/inframatrix' },
  ],
};
