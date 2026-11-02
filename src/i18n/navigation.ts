import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Not used by any page yet: pages keep next/link until their conversion PR.
export const { Link, redirect, permanentRedirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
