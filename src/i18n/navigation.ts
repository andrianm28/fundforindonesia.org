import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Used by the layout chrome (header, bottom nav, footer); pages keep next/link until their conversion PR.
export const { Link, redirect, permanentRedirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
